import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "./error-handler.ts";

// Body errors themselves are covered in json-body.test.ts.
describe("handleError", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("doesn't mistake another error shaped like body-parser's for a bad body", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const app = express();
		app.get("/", () => {
			throw Object.assign(new Error("conflict with document abc"), {
				type: "entity.conflict",
				expose: true,
				status: 409
			});
		});
		app.use(handleError);

		const res = await request(app).get("/");

		expect(res.status).toBe(500);
		expect(res.body).toEqual({
			error: "ERROR: an unexpected server error occurred"
		});
	});
});
