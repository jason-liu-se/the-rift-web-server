import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import request from "supertest";
import { SESSION_COOKIE } from "./auth/session-cookie.ts";
import { SESSION_TOKEN_TTL_SECONDS } from "./config/auth.ts";
import { app, testConfig } from "../test/app.ts";
import { EDITOR, sessionCookie } from "../test/session.ts";

describe("CORS", () => {
	const FRONTEND_CORS_HEADERS = {
		"access-control-allow-origin": testConfig.FRONTEND_URL,
		"access-control-allow-credentials": "true",
		"access-control-allow-methods": "GET,POST,OPTIONS",
		"access-control-allow-headers": "Content-Type"
	};

	it("allows the frontend, with credentials", async () => {
		const res = await request(app)
			.options("/news")
			.set("Origin", testConfig.FRONTEND_URL)
			.expect(204);

		expect(res.headers).toMatchObject(FRONTEND_CORS_HEADERS);
	});

	// Same headers for every Origin, so a cached response suits any caller.
	it.each([
		["another origin", "https://example.com"],
		["no Origin (server-to-server)", undefined]
	])(
		"allows only the frontend for %s, without varying",
		async (_name, origin) => {
			const req = request(app).get("/health");
			const res = await (origin ? req.set("Origin", origin) : req).expect(
				200
			);

			expect(res.headers).toMatchObject(FRONTEND_CORS_HEADERS);
			expect(res.headers).not.toHaveProperty("vary");
		}
	);
});

describe("private routes", () => {
	// Here, not in the test, so a failing assertion can't leave Date faked.
	afterEach(() => {
		vi.useRealTimers();
	});

	const NOT_LOGGED_IN = { error: "ERROR: not logged in" };

	it.each([
		["post", "/news"],
		["delete", "/gallery/some-id"],
		["get", "/news/drafts"],
		["get", "/does-not-exist"]
	] as const)(
		"answer %s %s with 401 when logged out",
		async (method, url) => {
			const res = await request(app)
				[method](url)
				.set("Origin", testConfig.FRONTEND_URL)
				.expect(401);

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

describe("CSRF", () => {
	const REFUSED = { error: "ERROR: request must come from the website" };

	it.each([
		["no Origin", undefined],
		["another origin", "https://evil.example.com"],
		["a sibling subdomain", "http://evil.localhost:4200"],
		["the website over another scheme", "https://localhost:4200"]
	])("refuses a logged-in write with %s", async (_, origin) => {
		const req = request(app)
			.delete("/news/some-id")
			.set("Cookie", await sessionCookie());

		const res = await (origin ? req.set("Origin", origin) : req).expect(
			403
		);

		expect(res.body).toEqual(REFUSED);
	});

	it("lets the website's writes through", async () => {
		await request(app)
			.delete("/news/some-id")
			.set("Origin", testConfig.FRONTEND_URL)
			.set("Cookie", await sessionCookie())
			.expect(404);
	});

	it("doesn't need an Origin to read (server rendering)", async () => {
		await request(app).get("/does-not-exist").expect(401);
	});
});
