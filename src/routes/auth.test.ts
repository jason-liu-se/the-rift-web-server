import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";
import request from "supertest";
import { createApp } from "../app.ts";
import { startSession } from "../auth/refresh-tokens.ts";
import { signSession } from "../auth/session.ts";
import {
	REFRESH_GRACE_MS,
	SESSION_IDLE_TIMEOUT_MS,
	SESSION_MAX_AGE_MS,
	SESSION_TOKEN_TTL_SECONDS
} from "../config/auth.ts";
import { AUTH_RATE_LIMIT } from "../config/rate-limits.ts";
import { REFRESH_COOKIE, SESSION_COOKIE } from "../auth/session-cookie.ts";
import * as redisManager from "../helpers/redis-manager.ts";
import { testConfig } from "../../test/app.ts";
import { clearRedis, storedSessions } from "../../test/redis.ts";

vi.mock(
	import("../helpers/redis-manager.ts"),
	() => import("../../test/redis.ts")
);

const USER = { id: "123", username: "editor", avatarUrl: "https://a.png" };
const SESSION = { user: USER, loginAt: Date.parse("2026-01-01T00:00:00Z") };
const LOGIN_AT = SESSION.loginAt;
const SESSION_ENDS_AT = LOGIN_AT + SESSION_MAX_AGE_MS;
const MS_PER_SECOND = 1000;
const TOKEN_TTL_MS = SESSION_TOKEN_TTL_SECONDS * MS_PER_SECOND;
const CLEARED = /Expires=Thu, 01 Jan 1970/;
// A refresh token is `<session ID>.<secret>`, both base64url.
const SESSION_ID_LENGTH = 22;
const SECRET_LENGTH = 43;

async function accessToken(secret = testConfig.JWT_SECRET) {
	return (await signSession(SESSION, secret)).token;
}

// Starts a session as the Discord login does, at the current time; returns its
// refresh token.
function logIn() {
	return startSession(SESSION);
}

function sha256(text: string) {
	return createHash("sha256").update(text).digest("base64url");
}

function setCookie(res: request.Response, name: string): string | undefined {
	const cookies = res.get("Set-Cookie") ?? [];
	return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}

function cookieValue(res: request.Response, name: string): string {
	return (
		new RegExp(`^${name}=([^;]*)`).exec(setCookie(res, name) ?? "")?.[1] ??
		""
	);
}

function getMe(token: string, target = app) {
	return request(target)
		.get("/auth/me")
		.set("Cookie", `${SESSION_COOKIE}=${token}`);
}

function refresh(token?: string) {
	const req = request(app)
		.post("/auth/refresh")
		.set("Origin", testConfig.FRONTEND_URL);
	return token ? req.set("Cookie", `${REFRESH_COOKIE}=${token}`) : req;
}

function setNow(ms: number) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(ms);
}

// Refreshes every idle timeout less 1 ms (so always in time) until `until`, as
// an active user would; returns the latest refresh token.
async function keepRefreshing(token: string, until: number) {
	let latest = token;
	for (let now = Date.now(); now < until;) {
		now = Math.min(now + SESSION_IDLE_TIMEOUT_MS - 1, until);
		setNow(now);
		latest = cookieValue(await refresh(latest).expect(204), REFRESH_COOKIE);
	}
	return latest;
}

// A fresh app per test: its rate-limit counts are in memory, and these tests
// make more /auth requests than one client may in a window.
let app = createApp(testConfig);
beforeEach(() => {
	app = createApp(testConfig);
});

// Tests start at the login.
beforeEach(() => {
	setNow(LOGIN_AT);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	clearRedis();
});

describe("GET /auth/me", () => {
	it("returns the logged-in user", async () => {
		const res = await getMe(await accessToken()).expect(200);

		expect(res.body).toEqual(USER);
		expect(res.headers["cache-control"]).toBe("no-store");
		// A valid token isn't re-issued on every request.
		expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
	});

	it("answers 401 without a session cookie", async () => {
		const res = await request(app).get("/auth/me").expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
	});

	it.each([
		["a tampered token", async () => `${await accessToken()}x`],
		[
			"a token signed with another secret",
			() => accessToken("x".repeat(64))
		],
		[
			"an HS256 token with the right secret",
			() =>
				new SignJWT({ username: USER.username })
					.setProtectedHeader({ alg: "HS256" })
					.setSubject(USER.id)
					.setIssuedAt()
					.setExpirationTime("15m")
					.sign(new TextEncoder().encode(testConfig.JWT_SECRET))
		],
		[
			"an unsigned (alg: none) token",
			() =>
				new UnsecuredJWT({ username: USER.username })
					.setSubject(USER.id)
					.encode()
		],
		["garbage", () => "not-a-jwt"]
	])("answers 401 for %s", async (_, makeToken) => {
		const res = await getMe(await makeToken()).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		// The cookie is left to expire, so it never clashes with a refresh.
		expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
	});

	it("answers 401 once the token expires, without re-issuing it", async () => {
		const token = await accessToken();
		setNow(LOGIN_AT + TOKEN_TTL_MS);

		const res = await getMe(token).expect(401);

		expect(setCookie(res, SESSION_COOKIE)).toBeUndefined();
	});

	it("accepts a token from before a restart (same secret)", async () => {
		const res = await getMe(
			await accessToken(),
			createApp({ ...testConfig })
		).expect(200);

		expect(res.body).toEqual(USER);
	});

	it("rejects every token once the secret is rotated", async () => {
		const rotatedApp = createApp({
			...testConfig,
			JWT_SECRET: "rotated".repeat(10)
		});

		await getMe(await accessToken(), rotatedApp).expect(401);
	});
});

describe("POST /auth/refresh", () => {
	it("issues a new access token and rotates the refresh token", async () => {
		const oldRefreshToken = await logIn();
		const now = LOGIN_AT + TOKEN_TTL_MS + 1;
		setNow(now);

		const res = await refresh(oldRefreshToken).expect(204);

		expect(res.headers["cache-control"]).toBe("no-store");
		// The access cookie lasts as long as its token.
		expect(setCookie(res, SESSION_COOKIE)).toMatch(
			new RegExp(
				`Max-Age=${SESSION_TOKEN_TTL_SECONDS};.*Path=/;.*HttpOnly.*SameSite=Lax`
			)
		);
		// The refresh cookie lasts until the session ends (a new idle timeout
		// from now) and only goes to /auth.
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(
			new RegExp(
				`Max-Age=${SESSION_IDLE_TIMEOUT_MS / 1000};.*Path=/auth;.*HttpOnly.*SameSite=Lax`
			)
		);

		const newAccessToken = cookieValue(res, SESSION_COOKIE);
		expect((await getMe(newAccessToken).expect(200)).body).toEqual(USER);

		// Same session; only the token hash and its createdAt change.
		const newRefreshToken = cookieValue(res, REFRESH_COOKIE);
		const [sessionId, secret] = newRefreshToken.split(".");
		expect(oldRefreshToken.startsWith(`${sessionId}.`)).toBe(true);
		expect(newRefreshToken).not.toBe(oldRefreshToken);
		expect([...storedSessions()]).toEqual([
			[
				sessionId,
				{
					fields: {
						discordUserId: USER.id,
						username: USER.username,
						avatarUrl: USER.avatarUrl,
						refreshTokenHash: sha256(secret ?? ""),
						createdAt: new Date(now).toISOString(),
						graceEndsAt: String(now + REFRESH_GRACE_MS),
						loginAt: new Date(LOGIN_AT).toISOString()
					},
					expiresAt: now + SESSION_IDLE_TIMEOUT_MS
				}
			]
		]);
		await refresh(newRefreshToken).expect(204);
	});

	it("stores only a hash of the token", async () => {
		const token = await logIn();

		const stored = JSON.stringify([...storedSessions()]);
		expect(stored).not.toContain(token.split(".")[1]);
	});

	it("ends the whole session when a used refresh token comes back", async () => {
		const warn = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		const stolenToken = await logIn();
		// The user refreshes first; the thief replays the old token later.
		const userToken = cookieValue(
			await refresh(stolenToken).expect(204),
			REFRESH_COOKIE
		);
		setNow(LOGIN_AT + REFRESH_GRACE_MS);

		const res = await refresh(stolenToken).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		expect(setCookie(res, SESSION_COOKIE)).toMatch(CLEARED);
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(CLEARED);
		expect(storedSessions().size).toBe(0);
		// The latest token is revoked too, whoever holds it.
		await refresh(userToken).expect(401);
		expect(String(warn.mock.calls[0])).toContain(`Discord user ${USER.id}`);
	});

	it("keeps a user's sessions separate", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const laptop = await logIn();
		const phone = await logIn();
		await refresh(laptop).expect(204);
		setNow(LOGIN_AT + REFRESH_GRACE_MS);

		// Replaying the laptop's old token ends only the laptop's session.
		await refresh(laptop).expect(401);

		expect(storedSessions().size).toBe(1);
		await refresh(phone).expect(204);
	});

	describe("within the grace window", () => {
		it("answers concurrent refreshes with the same new token", async () => {
			const token = await logIn();

			const responses = await Promise.all([
				refresh(token),
				refresh(token)
			]);

			const [first, second] = responses.map((res) => {
				expect(res.status).toBe(204);
				return cookieValue(res, REFRESH_COOKIE);
			});
			expect(second).toBe(first);
			// Whichever response the browser applies last, its cookie works.
			await refresh(first).expect(204);
		});

		it("lets a refresh whose response was lost be retried", async () => {
			const token = await logIn();
			const lost = cookieValue(
				await refresh(token).expect(204),
				REFRESH_COOKIE
			);
			setNow(LOGIN_AT + REFRESH_GRACE_MS - 1);

			const retry = await refresh(token).expect(204);

			expect(cookieValue(retry, REFRESH_COOKIE)).toBe(lost);
			const accessCookie = cookieValue(retry, SESSION_COOKIE);
			expect((await getMe(accessCookie).expect(200)).body).toEqual(USER);
			// A retry doesn't extend the window.
			setNow(LOGIN_AT + REFRESH_GRACE_MS);
			vi.spyOn(console, "warn").mockImplementation(() => undefined);
			await refresh(token).expect(401);
		});

		it("only accepts the previous token, not older ones", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => undefined);
			const first = await logIn();
			const second = cookieValue(
				await refresh(first).expect(204),
				REFRESH_COOKIE
			);
			await refresh(second).expect(204);

			await refresh(first).expect(401);
			expect(storedSessions().size).toBe(0);
		});
	});

	it.each([
		["no refresh token", undefined],
		["a malformed refresh token", "not-a-refresh-token"],
		[
			"an unknown session",
			`${"a".repeat(SESSION_ID_LENGTH)}.${"b".repeat(SECRET_LENGTH)}`
		]
	])("answers 401 and clears the cookies for %s", async (_, token) => {
		const res = await refresh(token).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		expect(setCookie(res, SESSION_COOKIE)).toMatch(CLEARED);
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(CLEARED);
	});

	it("ends the session SESSION_IDLE_TIMEOUT_MS after the login without a refresh", async () => {
		const token = await logIn();
		setNow(LOGIN_AT + SESSION_IDLE_TIMEOUT_MS + 1);

		await refresh(token).expect(401);
		expect(storedSessions().size).toBe(0);
	});

	describe("at the idle timeout", () => {
		const IDLE_ENDS_AT = LOGIN_AT + SESSION_IDLE_TIMEOUT_MS;

		it.each([
			["just before it", IDLE_ENDS_AT - 1, 204],
			// Redis expires a key only once its time has passed.
			["at it", IDLE_ENDS_AT, 204],
			["just after it", IDLE_ENDS_AT + 1, 401]
		])("answers a refresh %s", async (_, now, status) => {
			const token = await logIn();
			setNow(now);

			await refresh(token).expect(status);

			expect(storedSessions().size).toBe(status === 204 ? 1 : 0);
		});

		it("restarts it for concurrent refreshes just before it", async () => {
			const token = await logIn();
			setNow(IDLE_ENDS_AT - 1);

			const [first, second] = await Promise.all([
				refresh(token).expect(204),
				refresh(token).expect(204)
			]);

			const next = cookieValue(first, REFRESH_COOKIE);
			expect(cookieValue(second, REFRESH_COOKIE)).toBe(next);
			setNow(IDLE_ENDS_AT - 1 + SESSION_IDLE_TIMEOUT_MS - 1);
			await refresh(next).expect(204);
		});

		it("refuses concurrent refreshes just after it", async () => {
			const token = await logIn();
			setNow(IDLE_ENDS_AT + 1);

			await Promise.all([
				refresh(token).expect(401),
				refresh(token).expect(401)
			]);
		});

		// Holds the next refresh between its rotation and extending the
		// session, until `release` is called.
		function pauseNextExtend() {
			const extend = redisManager.extendSession;
			let reached!: () => void;
			let release!: () => void;
			const hasReached = new Promise<void>(
				(resolve) => (reached = resolve)
			);
			const released = new Promise<void>(
				(resolve) => (release = resolve)
			);
			vi.spyOn(redisManager, "extendSession").mockImplementationOnce(
				async (...args) => {
					reached();
					await released;
					await extend(...args);
				}
			);
			return { hasReached, release };
		}

		it("keeps the later expiry when a slower refresh extends last", async () => {
			const token = await logIn();
			const firstAt = IDLE_ENDS_AT - 2;
			const secondAt = IDLE_ENDS_AT - 1;
			setNow(firstAt);
			const { hasReached, release } = pauseNextExtend();
			const first = refresh(token)
				.expect(204)
				.then((res) => res);
			await hasReached;

			// A retry within the grace window extends the session first.
			setNow(secondAt);
			await refresh(token).expect(204);
			release();
			const next = cookieValue(await first, REFRESH_COOKIE);

			expect([...storedSessions().values()][0]?.expiresAt).toBe(
				secondAt + SESSION_IDLE_TIMEOUT_MS
			);
			setNow(secondAt + SESSION_IDLE_TIMEOUT_MS - 1);
			await refresh(next).expect(204);
		});

		it("doesn't revive a session that expires before its refresh extends it", async () => {
			const token = await logIn();
			setNow(IDLE_ENDS_AT - 1);
			const { hasReached, release } = pauseNextExtend();
			const pending = refresh(token)
				.expect(204)
				.then((res) => res);
			await hasReached;

			setNow(IDLE_ENDS_AT + 1);
			release();
			const next = cookieValue(await pending, REFRESH_COOKIE);

			expect(storedSessions().size).toBe(0);
			await refresh(next).expect(401);
		});
	});

	it("restarts the idle timeout on every refresh", async () => {
		const refreshedAt = LOGIN_AT + SESSION_IDLE_TIMEOUT_MS - 1;
		let token = await keepRefreshing(await logIn(), refreshedAt);

		// Still active one idle timeout after the login, so it can refresh.
		setNow(refreshedAt + SESSION_IDLE_TIMEOUT_MS - 1);
		token = cookieValue(await refresh(token).expect(204), REFRESH_COOKIE);
		setNow(Date.now() + SESSION_IDLE_TIMEOUT_MS + 1);

		await refresh(token).expect(401);
	});

	it("ends the session SESSION_MAX_AGE_MS after the login, however often it's refreshed", async () => {
		// The idle timeout from this refresh would run past the maximum age.
		const refreshedAt = SESSION_ENDS_AT - SESSION_IDLE_TIMEOUT_MS / 2;
		let token = await keepRefreshing(await logIn(), refreshedAt - 1);
		setNow(refreshedAt);

		const res = await refresh(token).expect(204);

		expect([...storedSessions().values()][0]?.expiresAt).toBe(
			SESSION_ENDS_AT
		);
		const remainingSeconds = (SESSION_ENDS_AT - refreshedAt) / 1000;
		expect(setCookie(res, REFRESH_COOKIE)).toContain(
			`Max-Age=${remainingSeconds};`
		);
		token = await keepRefreshing(
			cookieValue(res, REFRESH_COOKIE),
			SESSION_ENDS_AT - 1
		);
		setNow(SESSION_ENDS_AT + 1);
		await refresh(token).expect(401);
	});

	it("doesn't let an access token outlast the session", async () => {
		const secondsLeft = 60;
		const token = await keepRefreshing(
			await logIn(),
			SESSION_ENDS_AT - secondsLeft * MS_PER_SECOND - 1
		);
		setNow(SESSION_ENDS_AT - secondsLeft * MS_PER_SECOND);

		const res = await refresh(token).expect(204);

		expect(setCookie(res, SESSION_COOKIE)).toContain(
			`Max-Age=${secondsLeft};`
		);
		setNow(SESSION_ENDS_AT);
		await getMe(cookieValue(res, SESSION_COOKIE)).expect(401);
	});

	it("still refreshes if extending the session fails, keeping its expiry", async () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		vi.spyOn(redisManager, "extendSession").mockRejectedValueOnce(
			new Error("connection lost")
		);
		const token = await logIn();
		setNow(LOGIN_AT + TOKEN_TTL_MS);

		const res = await refresh(token).expect(204);

		expect(error).toHaveBeenCalledExactlyOnceWith(
			`ERROR: couldn't extend a session of Discord user ${USER.id}:`,
			expect.any(Error)
		);
		expect([...storedSessions().values()][0]?.expiresAt).toBe(
			LOGIN_AT + SESSION_IDLE_TIMEOUT_MS
		);
		await refresh(cookieValue(res, REFRESH_COOKIE)).expect(204);
	});

	it("answers 500 for a malformed stored session", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const token = await logIn();
		vi.spyOn(redisManager, "rotateRefreshToken").mockResolvedValue({
			outcome: "rotated",
			fields: { discordUserId: USER.id }
		});

		const res = await refresh(token).expect(500);

		expect(res.body).toEqual({
			error: "ERROR: an unexpected server error occurred"
		});
	});
});

describe("POST /auth/logout", () => {
	it("clears the cookies and ends only this session", async () => {
		const token = await logIn();
		const otherDevice = await logIn();

		const res = await request(app)
			.post("/auth/logout")
			.set("Origin", testConfig.FRONTEND_URL)
			.set("Cookie", [
				`${SESSION_COOKIE}=${await accessToken()}`,
				`${REFRESH_COOKIE}=${token}`
			])
			.expect(204);

		expect(setCookie(res, SESSION_COOKIE)).toMatch(
			/^session=;.*Path=\/;.*Expires=Thu, 01 Jan 1970.*HttpOnly.*SameSite=Lax/
		);
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(
			/^refresh_token=;.*Path=\/auth;.*Expires=Thu, 01 Jan 1970.*HttpOnly/
		);
		await refresh(token).expect(401);
		await refresh(otherDevice).expect(204);
	});

	it.each([
		["without a session", undefined],
		["with a malformed refresh token", "not-a-refresh-token"]
	])("succeeds %s", async (_, token) => {
		const req = request(app)
			.post("/auth/logout")
			.set("Origin", testConfig.FRONTEND_URL);
		await (
			token ? req.set("Cookie", `${REFRESH_COOKIE}=${token}`) : req
		).expect(204);
	});
});

describe("CSRF", () => {
	it.each(["/auth/refresh", "/auth/logout"])(
		"refuses POST %s from another origin, keeping the session",
		async (path) => {
			const token = await logIn();

			const res = await request(app)
				.post(path)
				.set("Origin", "https://evil.example.com")
				.set("Cookie", `${REFRESH_COOKIE}=${token}`)
				.expect(403);

			expect(res.body).toEqual({
				error: "ERROR: request must come from the website"
			});
			expect(res.get("Set-Cookie")).toBeUndefined();
			await refresh(token).expect(204);
		}
	);
});

// The write limiter's tests are in src/middleware/rate-limits.test.ts.
describe("auth rate limit", () => {
	it("counts logout and refresh in one budget", async () => {
		const limitedApp = createApp(testConfig);
		const post = (path: string) =>
			request(limitedApp)
				.post(path)
				.set("Origin", testConfig.FRONTEND_URL);
		for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
			await post("/auth/logout").expect(204);
		}

		await post("/auth/logout").expect(429);
		await post("/auth/refresh").expect(429);
	});

	it("answers 429 once a client exceeds the limit on /auth", async () => {
		// A fresh app, so other tests' requests don't count.
		const limitedApp = createApp(testConfig);

		for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
			await request(limitedApp).get("/auth/discord").expect(302);
		}
		const res = await request(limitedApp).get("/auth/discord").expect(429);

		expect(res.body).toEqual({
			error: "ERROR: too many requests; try again later"
		});
		expect(res.headers).toHaveProperty("retry-after");
		// Other routes aren't limited, /auth/me (only a read) included.
		await request(limitedApp).get("/health").expect(200);
		await request(limitedApp).get("/auth/me").expect(401);
		// Discord's redirect back still lands on the website's login page, by
		// any path Express routes to the callback.
		for (const path of [
			"/auth/discord/callback",
			"/auth/discord/callback/",
			"/Auth/Discord/Callback"
		]) {
			const callback = await request(limitedApp)
				.get(`${path}?code=abc&state=xyz`)
				.expect(302);
			expect(callback.headers["location"]).toBe(
				`${testConfig.FRONTEND_URL}/admin/login?error=rate-limited`
			);
		}
	});
});
