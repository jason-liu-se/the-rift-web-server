import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./app.ts";

describe("CORS", () => {
	it("answers preflight requests from any origin", async () => {
		const res = await request(app)
			.options("/news/get-items")
			.set("Origin", "https://example.com")
			.expect(204);

		expect(res.headers).toMatchObject({
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET,OPTIONS",
			"access-control-allow-headers": "Content-Type"
		});
	});
});
