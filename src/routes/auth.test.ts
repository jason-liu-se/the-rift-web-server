import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";
import request from "supertest";
import { createApp } from "../app.ts";
import { REFRESH_GRACE_MS, startSession } from "../auth/refresh-tokens.ts";
import {
	SESSION_MAX_AGE_MS,
	SESSION_TOKEN_TTL_SECONDS,
	signSession
} from "../auth/session.ts";
import { REFRESH_COOKIE, SESSION_COOKIE } from "../auth/session-cookie.ts";
import * as redisManager from "../helpers/redis-manager.ts";
import { app, testConfig } from "../../test/app.ts";
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
	const req = request(app).post("/auth/refresh");
	return token ? req.set("Cookie", `${REFRESH_COOKIE}=${token}`) : req;
}

function setNow(ms: number) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(ms);
}

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
		// The refresh cookie lasts until the session ends and only goes to /auth.
		const remainingSeconds = Math.floor((SESSION_ENDS_AT - now) / 1000);
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(
			new RegExp(
				`Max-Age=${remainingSeconds};.*Path=/auth;.*HttpOnly.*SameSite=Lax`
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
					expiresAt: SESSION_ENDS_AT
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

	it("ends the session 30 days after the login, however often it's refreshed", async () => {
		let token = await logIn();
		setNow(SESSION_ENDS_AT - 1);
		token = cookieValue(await refresh(token).expect(204), REFRESH_COOKIE);
		setNow(SESSION_ENDS_AT);

		await refresh(token).expect(401);
	});

	it("doesn't let an access token outlast the session", async () => {
		const secondsLeft = 60;
		const token = await logIn();
		setNow(SESSION_ENDS_AT - secondsLeft * MS_PER_SECOND);

		const res = await refresh(token).expect(204);

		expect(setCookie(res, SESSION_COOKIE)).toContain(
			`Max-Age=${secondsLeft};`
		);
		setNow(SESSION_ENDS_AT);
		await getMe(cookieValue(res, SESSION_COOKIE)).expect(401);
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
		const req = request(app).post("/auth/logout");
		await (
			token ? req.set("Cookie", `${REFRESH_COOKIE}=${token}`) : req
		).expect(204);
	});
});

describe("rate limiting", () => {
	it("answers 429 once a client exceeds the limit on /auth", async () => {
		// A fresh app, so other tests' requests don't count.
		const limitedApp = createApp(testConfig);
		const AUTH_RATE_LIMIT = 60;

		for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
			await request(limitedApp).post("/auth/logout").expect(204);
		}
		const res = await request(limitedApp).get("/auth/me").expect(429);

		expect(res.body).toEqual({
			error: "ERROR: too many requests; try again later"
		});
		expect(res.headers).toHaveProperty("retry-after");
		// Other routes aren't limited.
		await request(limitedApp).get("/health").expect(200);
		// Discord's redirect back still lands on the website's login page.
		const callback = await request(limitedApp)
			.get("/auth/discord/callback?code=abc&state=xyz")
			.expect(302);
		expect(callback.headers["location"]).toBe(
			`${testConfig.FRONTEND_URL}/admin/login?error=rate-limited`
		);
	});
});
