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
import { expectContractError } from "../../test/responses.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

// Oldest first, as inserted: _id holds the creation time.
const IMAGES = [
	{ caption: "First", imageUrl: "1.png", tags: ["spawn"] },
	{ caption: "Second", imageUrl: "2.png", tags: ["build", "spawn"] },
	{ caption: "Third", imageUrl: "3.png", tags: ["build"] }
].map((image) => ({ _id: new Types.ObjectId(), ...image }));

// What the routes send for IMAGES, newest first.
const NEWEST_FIRST = IMAGES.map(({ _id, ...fields }) => ({
	id: _id.toHexString(),
	...fields
})).toReversed();

function seedCollections(...collections: object[]) {
	return collection("gallery", "collections").insertMany(
		collections.map((fields) => ({ ...fields }))
	);
}

function seedImages(slug: string, images: object[]) {
	return collection("gallery", "images").insertMany(
		images.map((image) => ({ ...image, collection: slug }))
	);
}

function seedGallery() {
	return Promise.all([
		seedCollections({ slug: "builds", title: "Builds" }),
		seedImages("builds", IMAGES)
	]);
}

describe("GET /gallery", () => {
	it("returns every visible collection's slug and title, sorted", async () => {
		await seedCollections(
			{ slug: "season5", title: "Season 5", visible: true },
			{ slug: "builds", title: "Builds" },
			{ slug: "art", title: "Art" },
			{ slug: "secret", title: "Secret", visible: false }
		);

		const res = await request(app).get("/gallery").expect(200);

		expect(res.body).toEqual([
			{ slug: "art", title: "Art" },
			{ slug: "builds", title: "Builds" },
			{ slug: "season5", title: "Season 5" }
		]);
	});

	it("returns an empty list when there are no collections", async () => {
		const res = await request(app).get("/gallery").expect(200);

		expect(res.body).toEqual([]);
	});
});

describe("GET /gallery/:collection", () => {
	it("returns every image newest first with the total", async () => {
		await seedGallery();

		const res = await request(app).get("/gallery/builds").expect(200);

		// toEqual: only the contract's fields, with _id as id and no __v
		expect(res.body).toEqual({ items: NEWEST_FIRST, total: 3 });
	});

	it("returns only the collection's own visible images", async () => {
		await Promise.all([
			seedGallery(),
			seedCollections({ slug: "art", title: "Art" }),
			seedImages("art", [{ caption: "Art", imageUrl: "art.png" }]),
			seedImages("builds", [
				{ caption: "Hidden", imageUrl: "h.png", visible: false }
			])
		]);

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body).toEqual({ items: NEWEST_FIRST, total: 3 });
	});

	it("gives images stored without tags an empty list", async () => {
		await Promise.all([
			seedCollections({ slug: "builds", title: "Builds" }),
			seedImages("builds", [{ caption: "Old", imageUrl: "old.png" }])
		]);

		const res = await request(app).get("/gallery/builds").expect(200);

		expect(res.body.items).toMatchObject([{ caption: "Old", tags: [] }]);
	});

	it("returns the page selected by startIndex and limit", async () => {
		await seedGallery();

		const res = await request(app)
			.get("/gallery/builds?startIndex=1&limit=1")
			.expect(200);

		expect(res.body.total).toBe(3);
		expect(res.body.items).toMatchObject([{ caption: "Second" }]);
	});

	it.each([
		["build", ["Third", "Second"]],
		["build,spawn", ["Second"]],
		["missing", []]
	])("keeps only images with every tag (%s)", async (tags, captions) => {
		await seedGallery();

		const res = await request(app)
			.get(`/gallery/builds?tags=${tags}`)
			.expect(200);

		expect(res.body.total).toBe(captions.length);
		expect(
			res.body.items.map(({ caption }: { caption: string }) => caption)
		).toEqual(captions);
	});

	it.each(["spawn,build", "Build", "build,build", "build,", "%20build"])(
		"rejects tags not written one way (%s)",
		async (tags) => {
			await seedGallery();

			const res = await request(app)
				.get(`/gallery/builds?tags=${tags}`)
				.expect(400);

			expect(res.body.error).toMatch(/tags must be lowercase/);
		}
	);

	it("returns an empty page for an existing, empty collection", async () => {
		await seedCollections({ slug: "empty", title: "Empty" });

		const res = await request(app).get("/gallery/empty").expect(200);

		expect(res.body).toEqual({ items: [], total: 0 });
	});

	it("answers 500 when a stored image breaks the contract", async () => {
		await Promise.all([
			seedCollections({ slug: "builds", title: "Builds" }),
			seedImages("builds", [{ caption: "No image URL" }])
		]);

		await expectContractError("/gallery/builds");
	});

	it.each([
		["doesn't exist", []],
		["is hidden", [{ slug: "missing", title: "Hidden", visible: false }]]
	])("answers 404 for a collection that %s", async (_name, collections) => {
		if (collections.length > 0) {
			await seedCollections(...collections);
		}

		const res = await request(app).get("/gallery/missing").expect(404);

		expect(res.body).toEqual({
			error: "ERROR: gallery collection 'missing' not found"
		});
	});

	it.each(["bad%24name", "system.users", "Season5", "a".repeat(41)])(
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
	it("returns the number of visible images in the collection", async () => {
		await Promise.all([
			seedGallery(),
			seedImages("builds", [
				{ caption: "Hidden", imageUrl: "h.png", visible: false }
			])
		]);

		const res = await request(app).get("/gallery/builds/count").expect(200);

		expect(res.body).toEqual({ total: 3 });
	});

	it("counts only images with every tag", async () => {
		await seedGallery();

		const res = await request(app)
			.get("/gallery/builds/count?tags=build")
			.expect(200);

		expect(res.body).toEqual({ total: 2 });
	});

	it("rejects tags not written one way", async () => {
		await seedGallery();

		await request(app).get("/gallery/builds/count?tags=b,a").expect(400);
	});

	it("answers 404 for a collection that doesn't exist", async () => {
		const res = await request(app)
			.get("/gallery/missing/count")
			.expect(404);

		expect(res.body).toEqual({
			error: "ERROR: gallery collection 'missing' not found"
		});
	});

	it("answers 404 for a hidden collection", async () => {
		await seedCollections({ slug: "secret", title: "S", visible: false });

		await request(app).get("/gallery/secret/count").expect(404);
	});

	it("rejects an invalid collection name", async () => {
		const res = await request(app)
			.get("/gallery/bad%24name/count")
			.expect(400);

		expect(res.body.error).toMatch(/collection: invalid collection name/);
	});
});

describe("GET /gallery/:collection/tags", () => {
	it("returns the tags on the collection's visible images, sorted", async () => {
		await Promise.all([
			seedGallery(),
			seedImages("builds", [
				{
					caption: "Hidden",
					imageUrl: "h.png",
					tags: ["secret"],
					visible: false
				}
			]),
			seedCollections({ slug: "art", title: "Art" }),
			seedImages("art", [
				{ caption: "Art", imageUrl: "a.png", tags: ["art"] }
			])
		]);

		const res = await request(app).get("/gallery/builds/tags").expect(200);

		expect(res.body).toEqual(["build", "spawn"]);
	});

	it("answers 404 for a hidden collection", async () => {
		await seedCollections({ slug: "secret", title: "S", visible: false });

		await request(app).get("/gallery/secret/tags").expect(404);
	});

	it("answers 404 for a collection that doesn't exist", async () => {
		await request(app).get("/gallery/missing/tags").expect(404);
	});

	it("rejects an invalid collection name", async () => {
		await request(app).get("/gallery/bad%24name/tags").expect(400);
	});
});
