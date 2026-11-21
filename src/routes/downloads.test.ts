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

const MAP = {
	_id: new Types.ObjectId(),
	title: "Map",
	desc: "A map",
	downloadUrl: "map.zip",
	imageUrl: "map.png"
};
const PACK = {
	_id: new Types.ObjectId(),
	title: "Pack",
	desc: "A pack",
	downloadUrl: "pack.zip",
	imageUrl: "pack.png"
};

// Seeds the collections and their items, as { slug: items }.
function seedDownloads(
	groups: Record<string, object[]>,
	collectionFields: object = {}
) {
	const slugs = Object.keys(groups);
	return Promise.all([
		collection("downloads", "collections").insertMany(
			slugs.map((slug) => ({
				slug,
				title: `Title ${slug}`,
				...collectionFields
			}))
		),
		...slugs
			.filter((slug) => groups[slug]?.length)
			.map((slug) =>
				collection("downloads", "items").insertMany(
					(groups[slug] ?? []).map((item) => ({
						...item,
						collection: slug
					}))
				)
			)
	]);
}

function item(title: string, fields: object = {}) {
	return {
		_id: new Types.ObjectId(),
		title,
		desc: "d",
		downloadUrl: `${title}.zip`,
		imageUrl: `${title}.png`,
		...fields
	};
}

describe("GET /downloads", () => {
	it("returns every visible collection with its items, sorted by slug", async () => {
		await Promise.all([
			seedDownloads({ packs: [PACK], maps: [MAP], empty: [] }),
			seedDownloads({ hidden: [item("h")] }, { visible: false }),
			seedDownloads({ other: [] }).then(() =>
				collection("downloads", "items").insertOne(
					item("Hidden", { collection: "maps", visible: false })
				)
			)
		]);

		const res = await request(app).get("/downloads").expect(200);

		// toEqual: only the contract's fields, with _id as id and no __v
		expect(res.body).toEqual([
			{ name: "empty", title: "Title empty", items: [] },
			{ name: "maps", title: "Title maps", items: [withId(MAP)] },
			{ name: "other", title: "Title other", items: [] },
			{ name: "packs", title: "Title packs", items: [withId(PACK)] }
		]);
	});

	it("returns an empty list when there are no collections", async () => {
		const res = await request(app).get("/downloads").expect(200);

		expect(res.body).toEqual([]);
	});
});

describe("GET /downloads/:collection", () => {
	it("returns the collection's items", async () => {
		await seedDownloads({ maps: [MAP], packs: [PACK] });

		const res = await request(app).get("/downloads/maps").expect(200);

		expect(res.body).toEqual([withId(MAP)]);
	});

	it("orders items by sortOrder, then the rest by title", async () => {
		const items = [
			item("b"),
			item("second", { sortOrder: 2 }),
			item("a"),
			item("first", { sortOrder: -1 })
		];
		await seedDownloads({ maps: items });

		const res = await request(app).get("/downloads/maps").expect(200);

		expect(res.body.map(({ title }: { title: string }) => title)).toEqual([
			"first",
			"second",
			"a",
			"b"
		]);
	});

	it("leaves out hidden items", async () => {
		await seedDownloads({ maps: [MAP, item("h", { visible: false })] });

		const res = await request(app).get("/downloads/maps").expect(200);

		expect(res.body).toEqual([withId(MAP)]);
	});

	it("answers 404 for a hidden collection", async () => {
		await seedDownloads({ maps: [MAP] }, { visible: false });

		const res = await request(app).get("/downloads/maps").expect(404);

		expect(res.body).toEqual({
			error: "ERROR: download collection 'maps' not found"
		});
	});

	it("answers 500 when a stored item breaks the contract", async () => {
		await seedDownloads({ maps: [{ title: "No url" }] });

		await expectContractError("/downloads/maps");
	});

	it("answers 404 for a collection that doesn't exist", async () => {
		const res = await request(app).get("/downloads/missing").expect(404);

		expect(res.body).toEqual({
			error: "ERROR: download collection 'missing' not found"
		});
	});

	it("rejects an invalid collection name", async () => {
		const res = await request(app).get("/downloads/bad%24name").expect(400);

		expect(res.body.error).toMatch(/collection: invalid collection name/);
	});
});
