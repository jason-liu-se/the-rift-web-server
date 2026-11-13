import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../test/app.ts";
import { galleryDb } from "../models/gallery-schema.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { expectContractError } from "../../test/responses.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

function seedGallery() {
	return collection("gallery", "builds").insertMany([
		{ caption: "First", url: "1.png" },
		{ caption: "Second", url: "2.png" },
		{ caption: "Third", url: "3.png" }
	]);
}

describe("GET /gallery/:collection", () => {
	it("returns every image in the collection with the total", async () => {
		await seedGallery();

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body.total).toBe(3);
		// toEqual: only the contract's fields, no MongoDB _id or __v
		expect(res.body.items).toEqual([
			{ caption: "First", url: "1.png" },
			{ caption: "Second", url: "2.png" },
			{ caption: "Third", url: "3.png" }
		]);
	});

	it("returns the page selected by startIndex and limit", async () => {
		await seedGallery();

		const res = await request(app)
			.get("/gallery/builds?startIndex=1&limit=1")
			.expect(200);

		expect(res.body.total).toBe(3);
		expect(res.body.items).toMatchObject([{ caption: "Second" }]);
	});

	it("returns an empty page for an existing, empty collection", async () => {
		await galleryDb.createCollection("empty");

		const res = await request(app).get("/gallery/empty").expect(200);

		expect(res.body).toEqual({ items: [], total: 0 });
	});

	it("answers 500 when a stored image breaks the contract", async () => {
		await collection("gallery", "builds").insertOne({ caption: "No url" });

		await expectContractError("/gallery/builds");
	});

	it("answers 404 for a collection that doesn't exist", async () => {
		const res = await request(app).get("/gallery/missing").expect(404);

		expect(res.body).toEqual({
			error: "ERROR: gallery collection 'missing' not found"
		});
	});

	it.each(["bad%24name", "system.users"])(
		"rejects an invalid collection name (%s)",
		async (name) => {
			const res = await request(app).get(`/gallery/${name}`).expect(400);

			expect(res.body.error).toMatch(
				/collection: invalid collection name/
			);
		}
	);

	it("rejects invalid pagination", async () => {
		await seedGallery();

		const res = await request(app)
			.get("/gallery/builds?limit=0")
			.expect(400);

		expect(res.body.error).toMatch(/^ERROR: invalid request parameters/);
	});
});

describe("GET /gallery/:collection/count", () => {
	it("returns the number of images in the collection", async () => {
		await seedGallery();

		const res = await request(app).get("/gallery/builds/count").expect(200);

		expect(res.body).toEqual({ total: 3 });
	});

	it("answers 404 for a collection that doesn't exist", async () => {
		const res = await request(app)
			.get("/gallery/missing/count")
			.expect(404);

		expect(res.body).toEqual({
			error: "ERROR: gallery collection 'missing' not found"
		});
	});

	it("rejects an invalid collection name", async () => {
		const res = await request(app)
			.get("/gallery/bad%24name/count")
			.expect(400);

		expect(res.body.error).toMatch(/collection: invalid collection name/);
	});
});
