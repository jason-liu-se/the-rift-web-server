import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { app } from "../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { expectContractError, withId } from "../../test/responses.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const IMAGES = [
	{ _id: new Types.ObjectId(), caption: "First", imageUrl: "1.png" },
	{ _id: new Types.ObjectId(), caption: "Second", imageUrl: "2.png" },
	{ _id: new Types.ObjectId(), caption: "Third", imageUrl: "3.png" }
];

function seedCollections(...slugs: string[]) {
	return collection("gallery", "collections").insertMany(
		slugs.map((slug) => ({ slug, title: slug }))
	);
}

function seedGallery() {
	return Promise.all([
		seedCollections("builds"),
		collection("gallery", "images").insertMany(
			IMAGES.map((image) => ({ ...image, collection: "builds" }))
		)
	]);
}

describe("GET /gallery", () => {
	it("returns every collection's name, sorted", async () => {
		await seedCollections("season5", "builds", "art");

		const res = await request(app).get("/gallery").expect(200);

		expect(res.body).toEqual(["art", "builds", "season5"]);
	});

	it("returns an empty list when there are no collections", async () => {
		const res = await request(app).get("/gallery").expect(200);

		expect(res.body).toEqual([]);
	});
});

describe("GET /gallery/:collection", () => {
	it("returns every image in the collection with the total", async () => {
		await seedGallery();

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body.total).toBe(3);
		// toEqual: only the contract's fields, with _id as id and no __v
		expect(res.body.items).toEqual(IMAGES.map(withId));
	});

	it("returns only the collection's own images", async () => {
		await Promise.all([
			seedGallery(),
			seedCollections("art"),
			collection("gallery", "images").insertOne({
				collection: "art",
				caption: "Art",
				imageUrl: "art.png"
			})
		]);

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body.total).toBe(3);
		expect(res.body.items).toEqual(IMAGES.map(withId));
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
		await seedCollections("empty");

		const res = await request(app).get("/gallery/empty").expect(200);

		expect(res.body).toEqual({ items: [], total: 0 });
	});

	it("answers 500 when a stored image breaks the contract", async () => {
		await Promise.all([
			seedCollections("builds"),
			collection("gallery", "images").insertOne({
				collection: "builds",
				caption: "No image URL"
			})
		]);

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
