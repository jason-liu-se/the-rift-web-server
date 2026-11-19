import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { app } from "../../test/app.ts";
import { galleryDb } from "../models/gallery-schema.ts";
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
	{ _id: new Types.ObjectId(), caption: "First", url: "1.png" },
	{ _id: new Types.ObjectId(), caption: "Second", url: "2.png" },
	{ _id: new Types.ObjectId(), caption: "Third", url: "3.png" }
];

const VARIANTS = {
	mobile: "4-mobile.png",
	tablet: "4-tablet.png",
	desktop: "4-desktop.png"
};

function seedGallery() {
	return collection("gallery", "builds").insertMany(IMAGES);
}

describe("GET /gallery", () => {
	it("returns every collection's name, sorted", async () => {
		await Promise.all([
			seedGallery(),
			galleryDb.createCollection("art"),
			galleryDb.createCollection("season5")
		]);

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

	it.each([
		{ name: "every variant", variants: VARIANTS },
		{ name: "some variants", variants: { mobile: VARIANTS.mobile } },
		{ name: "no variants", variants: {} }
	])("returns an image's variants ($name)", async ({ variants }) => {
		const image = {
			_id: new Types.ObjectId(),
			caption: "Fourth",
			url: "4.png",
			variants
		};
		await collection("gallery", "builds").insertOne(image);

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body.items).toEqual([withId(image)]);
	});

	it("drops variants outside the contract", async () => {
		const image = {
			_id: new Types.ObjectId(),
			caption: "Fourth",
			url: "4.png"
		};
		await collection("gallery", "builds").insertOne({
			...image,
			variants: { ...VARIANTS, watch: "4-watch.png" }
		});

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body.items).toEqual([
			{ ...withId(image), variants: VARIANTS }
		]);
	});

	it("answers 500 when a stored variant isn't a string", async () => {
		await collection("gallery", "builds").insertOne({
			caption: "Fourth",
			url: "4.png",
			variants: { mobile: 4 }
		});

		await expectContractError("/gallery/builds");
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
