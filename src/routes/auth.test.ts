import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";
import request from "supertest";
import { createApp } from "../app.ts";
import { issueRefreshToken } from "../auth/refresh-tokens.ts";
import {
	SESSION_MAX_AGE_MS,
	SESSION_TOKEN_TTL_SECONDS,
	signSession
} from "../auth/session.ts";
import { REFRESH_COOKIE, SESSION_COOKIE } from "../auth/session-cookie.ts";
import * as redisManager from "../helpers/redis-manager.ts";
import { app, testConfig } from "../../test/app.ts";
import { clearRedis, storedRefreshTokens } from "../../test/redis.ts";

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

async function accessToken(secret = testConfig.JWT_SECRET) {
	return (await signSession(SESSION, secret)).token;
}

// A refresh token as the Discord login issues it, stored at the current time.
function refreshToken() {
	return issueRefreshToken(SESSION);
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
	])("answers 401 and clears the cookie for %s", async (_, makeToken) => {
		const res = await getMe(await makeToken()).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		expect(setCookie(res, SESSION_COOKIE)).toMatch(CLEARED);
	});

	it("answers 401 once the token expires, without re-issuing it", async () => {
		const token = await accessToken();
		setNow(LOGIN_AT + TOKEN_TTL_MS);

		const res = await getMe(token).expect(401);

		expect(setCookie(res, SESSION_COOKIE)).toMatch(CLEARED);
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
		const oldRefreshToken = await refreshToken();
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

		// Only the new refresh token is stored; it keeps the login date.
		expect(storedRefreshTokens()).toEqual([
			{
				value: {
					discordUserId: USER.id,
					username: USER.username,
					avatarUrl: USER.avatarUrl,
					createdAt: new Date(now).toISOString(),
					loginAt: new Date(LOGIN_AT).toISOString()
				},
				expiresAt: SESSION_ENDS_AT
			}
		]);
		const newRefreshToken = cookieValue(res, REFRESH_COOKIE);
		expect(newRefreshToken).not.toBe(oldRefreshToken);
		await refresh(newRefreshToken).expect(204);
	});

	it("doesn't store the token itself", async () => {
		const token = await refreshToken();

		expect(JSON.stringify(storedRefreshTokens())).not.toContain(token);
	});

	it("answers 401 for a refresh token that was already used", async () => {
		const token = await refreshToken();
		await refresh(token).expect(204);

		const res = await refresh(token).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		expect(setCookie(res, SESSION_COOKIE)).toMatch(CLEARED);
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(CLEARED);
	});

	it.each([
		["no refresh token", undefined],
		["an unknown refresh token", "unknown-token"]
	])("answers 401 and clears the cookies for %s", async (_, token) => {
		const res = await refresh(token).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		expect(setCookie(res, SESSION_COOKIE)).toMatch(CLEARED);
		expect(setCookie(res, REFRESH_COOKIE)).toMatch(CLEARED);
	});

	it("ends the session 30 days after the login, however often it's refreshed", async () => {
		let token = await refreshToken();
		setNow(SESSION_ENDS_AT - 1);
		token = cookieValue(await refresh(token).expect(204), REFRESH_COOKIE);
		setNow(SESSION_ENDS_AT);

		await refresh(token).expect(401);
	});

	it("doesn't let an access token outlast the session", async () => {
		const secondsLeft = 60;
		const token = await refreshToken();
		setNow(SESSION_ENDS_AT - secondsLeft * MS_PER_SECOND);

		const res = await refresh(token).expect(204);

		expect(setCookie(res, SESSION_COOKIE)).toContain(
			`Max-Age=${secondsLeft};`
		);
		setNow(SESSION_ENDS_AT);
		await getMe(cookieValue(res, SESSION_COOKIE)).expect(401);
	});

	it("answers 500 for a malformed stored refresh token", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(redisManager, "takeRefreshToken").mockResolvedValue(
			JSON.stringify({ discordUserId: USER.id })
		);

		const res = await refresh("some-token").expect(500);

		expect(res.body).toEqual({
			error: "ERROR: an unexpected server error occurred"
		});
	});
});

describe("POST /auth/logout", () => {
	it("clears the cookies and revokes the refresh token", async () => {
		const token = await refreshToken();

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
		expect(storedRefreshTokens()).toEqual([]);
		await refresh(token).expect(401);
	});

	it("succeeds without a session", async () => {
		await request(app).post("/auth/logout").expect(204);
	});
});

describe("rate limiting", () => {
	it("answers 429 once a client exceeds the limit on /auth", async () => {
		// A fresh app, so other tests' requests don't count.
		const limitedApp = createApp(testConfig);
		const AUTH_RATE_LIMIT = 100;

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
	});
});
