import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import request from "supertest";
import { createApp } from "../app.ts";
import {
	SESSION_MAX_AGE_MS,
	SESSION_TOKEN_TTL_SECONDS,
	signSession
} from "../auth/session.ts";
import { SESSION_COOKIE } from "../auth/session-cookie.ts";
import { app, testConfig } from "../../test/app.ts";

const USER = { id: "123", username: "editor", avatarUrl: "https://a.png" };
const LOGIN_AT = Date.parse("2026-01-01T00:00:00Z");
const MS_PER_SECOND = 1000;

function sessionToken(secret = testConfig.JWT_SECRET) {
	return signSession({ user: USER, loginAt: LOGIN_AT }, secret);
}

function cookieHeader(token: string) {
	return `${SESSION_COOKIE}=${token}`;
}

// The Set-Cookie header for the session cookie, if the response sent one.
function sessionSetCookie(res: request.Response): string | undefined {
	const cookies = res.get("Set-Cookie") ?? [];
	return cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

function setNow(ms: number) {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(ms);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("GET /auth/me", () => {
	it("returns the logged-in user", async () => {
		setNow(LOGIN_AT);
		const token = await sessionToken();

		const res = await request(app)
			.get("/auth/me")
			.set("Cookie", cookieHeader(token))
			.expect(200);

		expect(res.body).toEqual(USER);
		// A valid token isn't re-issued on every request.
		expect(sessionSetCookie(res)).toBeUndefined();
	});

	it("answers 401 without a session cookie", async () => {
		const res = await request(app).get("/auth/me").expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
	});

	it.each([
		["a tampered token", async () => `${await sessionToken()}x`],
		[
			"a token signed with another secret",
			() => sessionToken("x".repeat(64))
		],
		[
			"an unsigned (alg: none) token",
			() =>
				new UnsecuredJWT({ username: USER.username, loginAt: LOGIN_AT })
					.setSubject(USER.id)
					.encode()
		],
		["garbage", () => "not-a-jwt"]
	])("answers 401 and clears the cookie for %s", async (_, makeToken) => {
		setNow(LOGIN_AT);

		const res = await request(app)
			.get("/auth/me")
			.set("Cookie", cookieHeader(await makeToken()))
			.expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
		expect(sessionSetCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
	});

	it("re-issues an expired token while the session lasts", async () => {
		setNow(LOGIN_AT);
		const token = await sessionToken();
		const now = LOGIN_AT + SESSION_TOKEN_TTL_SECONDS * MS_PER_SECOND + 1;
		setNow(now);

		const res = await request(app)
			.get("/auth/me")
			.set("Cookie", cookieHeader(token))
			.expect(200);

		expect(res.body).toEqual(USER);
		const refreshed = sessionSetCookie(res);
		expect(refreshed).toMatch(/HttpOnly/);
		expect(refreshed).toMatch(/SameSite=Lax/);
		// The cookie lasts until the session ends, not until the new token expires.
		const remainingSeconds = (LOGIN_AT + SESSION_MAX_AGE_MS - now) / 1000;
		expect(refreshed).toContain(`Max-Age=${Math.floor(remainingSeconds)}`);

		// The re-issued token works on its own.
		const newToken = /^session=([^;]+)/.exec(refreshed ?? "")?.[1] ?? "";
		await request(app)
			.get("/auth/me")
			.set("Cookie", cookieHeader(newToken))
			.expect(200);
	});

	it("answers 401 once the session is over", async () => {
		setNow(LOGIN_AT);
		const token = await sessionToken();
		setNow(LOGIN_AT + SESSION_MAX_AGE_MS);

		const res = await request(app)
			.get("/auth/me")
			.set("Cookie", cookieHeader(token))
			.expect(401);

		expect(sessionSetCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
	});

	it("accepts a session from before a restart (same secret)", async () => {
		setNow(LOGIN_AT);
		const token = await sessionToken();
		const restartedApp = createApp({ ...testConfig });

		const res = await request(restartedApp)
			.get("/auth/me")
			.set("Cookie", cookieHeader(token))
			.expect(200);

		expect(res.body).toEqual(USER);
	});

	it("rejects every session once the secret is rotated", async () => {
		setNow(LOGIN_AT);
		const token = await sessionToken();
		const rotatedApp = createApp({
			...testConfig,
			JWT_SECRET: "rotated".repeat(10)
		});

		await request(rotatedApp)
			.get("/auth/me")
			.set("Cookie", cookieHeader(token))
			.expect(401);
	});
});

describe("POST /auth/logout", () => {
	it("clears the session cookie", async () => {
		setNow(LOGIN_AT);
		const token = await sessionToken();

		const res = await request(app)
			.post("/auth/logout")
			.set("Cookie", cookieHeader(token))
			.expect(204);

		expect(sessionSetCookie(res)).toMatch(
			/^session=;.*Expires=Thu, 01 Jan 1970.*HttpOnly.*SameSite=Lax/
		);
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
