import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../test/app.ts";

describe("GET /health", () => {
	it("answers 200 with an empty body without needing the database", async () => {
		const res = await request(app).get("/health").expect(200);

		expect(res.text).toBe("");
	});
});
