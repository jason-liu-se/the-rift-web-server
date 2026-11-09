import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.ts";

describe("CORS", () => {
	it("answers preflight requests from any origin", async () => {
		const res = await request(app)
			.options("/news")
			.set("Origin", "https://example.com")
			.expect(204);

		expect(res.headers).toMatchObject({
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET,OPTIONS",
			"access-control-allow-headers": "Content-Type"
		});
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
