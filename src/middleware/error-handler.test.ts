import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { NotFoundError } from "../errors/not-found-error.ts";
import { cacheByContentVersion } from "./cache-control.ts";
import { handleError } from "./error-handler.ts";

const CONTENT_VERSION = 1;

vi.mock(import("../helpers/mongo-manager.ts"), () => ({
	getContentVersion: () => Promise.resolve(CONTENT_VERSION)
}));

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

	it("never lets an error be cached, even from a cacheable route", async () => {
		const app = express();
		app.get("/", cacheByContentVersion, () => {
			throw new NotFoundError("thing");
		});
		app.use(handleError);

		const res = await request(app)
			.get(`/?v=${CONTENT_VERSION}`)
			.expect(404);

		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.headers).not.toHaveProperty("cdn-cache-control");
	});
});
