import { describe, expect, it, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import request from "supertest";
import { SESSION_COOKIE } from "./auth/session-cookie.ts";
import { SESSION_TOKEN_TTL_SECONDS } from "./config/auth.ts";
import { app, testConfig } from "../test/app.ts";
import { EDITOR, sessionCookie } from "../test/session.ts";

describe("CORS", () => {
	it("allows the frontend, with credentials", async () => {
		const res = await request(app)
			.options("/news")
			.set("Origin", testConfig.FRONTEND_URL)
			.expect(204);

		expect(res.headers).toMatchObject({
			"access-control-allow-origin": testConfig.FRONTEND_URL,
			"access-control-allow-credentials": "true",
			"access-control-allow-methods": "GET,POST,OPTIONS",
			"access-control-allow-headers": "Content-Type",
			vary: "Origin"
		});
	});

	it("sends no CORS headers to other origins", async () => {
		const res = await request(app)
			.options("/news")
			.set("Origin", "https://example.com")
			.expect(204);

		expect(res.headers).not.toHaveProperty("access-control-allow-origin");
		expect(res.headers).not.toHaveProperty(
			"access-control-allow-credentials"
		);
	});

	it("serves requests without an Origin (server-to-server)", async () => {
		const res = await request(app).get("/health").expect(200);

		expect(res.headers).not.toHaveProperty("access-control-allow-origin");
	});
});

describe("private routes", () => {
	const NOT_LOGGED_IN = { error: "ERROR: not logged in" };

	it.each([
		["post", "/news"],
		["delete", "/gallery/some-id"],
		["get", "/news/drafts"],
		["get", "/does-not-exist"]
	] as const)(
		"answer %s %s with 401 when logged out",
		async (method, url) => {
			const res = await request(app)[method](url).expect(401);

			expect(res.body).toEqual(NOT_LOGGED_IN);
		}
	);

	it("reject an access token signed with another secret", async () => {
		const cookie = await sessionCookie(EDITOR, "x".repeat(64));

		const res = await request(app)
			.get("/news/drafts")
			.set("Cookie", cookie)
			.expect(401);

		expect(res.body).toEqual(NOT_LOGGED_IN);
	});

	it("reject an unsigned access token", async () => {
		const token = new UnsecuredJWT({ username: EDITOR.username })
			.setSubject(EDITOR.id)
			.encode();

		await request(app)
			.get("/news/drafts")
			.set("Cookie", `${SESSION_COOKIE}=${token}`)
			.expect(401);
	});

	it("reject an expired access token", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		const cookie = await sessionCookie();
		vi.setSystemTime(Date.now() + SESSION_TOKEN_TTL_SECONDS * 1000);

		await request(app)
			.get("/news/drafts")
			.set("Cookie", cookie)
			.expect(401);
		vi.useRealTimers();
	});

	it("let a logged-in editor through, uncached", async () => {
		const res = await request(app)
			.get("/does-not-exist")
			.set("Cookie", await sessionCookie())
			.expect(404);

		expect(res.body).toEqual({
			error: "ERROR: GET /does-not-exist not found"
		});
		expect(res.headers["cache-control"]).toBe("no-store");
	});
});
