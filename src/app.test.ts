import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, testConfig } from "../test/app.ts";

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

describe("unknown routes", () => {
	it("answers 404 with a JSON error", async () => {
		const res = await request(app).get("/does-not-exist").expect(404);

		expect(res.body).toEqual({
			error: "ERROR: GET /does-not-exist not found"
		});
	});
});
