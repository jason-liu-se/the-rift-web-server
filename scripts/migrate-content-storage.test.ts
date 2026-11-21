import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import mongoose, { Types } from "mongoose";
import {
	migrateContentStorage,
	slugFor,
	titleFor
} from "./migrate-content-storage.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../test/database.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const RUN = { dryRun: false, dropOld: false };

const SEASON5 = [
	{ _id: new Types.ObjectId(), caption: "One", imageUrl: "1.png" },
	{ _id: new Types.ObjectId(), caption: "Two", imageUrl: "2.png" }
];
const WORLD = {
	_id: new Types.ObjectId(),
	title: "World",
	desc: "d",
	downloadUrl: "w.zip",
	imageUrl: "w.png"
};

function seedOldShape() {
	return Promise.all([
		collection("gallery", "season5").insertMany(SEASON5),
		collection("downloads", "Spawn_Worlds").insertOne({ ...WORLD })
	]);
}

async function collectionNames(database: string): Promise<string[]> {
	const collections = await mongoose.connection
		.useDb(database)
		.listCollections();
	return collections.map(({ name }) => name).toSorted();
}

describe("slugFor and titleFor", () => {
	it.each([
		["season5", "season5", "Season 5"],
		["season-5", "season-5", "Season 5"],
		["Spawn_Worlds", "spawn-worlds", "Spawn Worlds"]
	])("turn %s into %s and %s", (name, slug, title) => {
		expect(slugFor(name)).toBe(slug);
		expect(titleFor(name)).toBe(title);
	});
});

describe("migrateContentStorage", () => {
	it("moves every item, keeping its _id, and adds its collection", async () => {
		await seedOldShape();

		const report = await migrateContentStorage(mongoose.connection, RUN);

		expect(report.problems).toEqual([]);
		expect(await collection("gallery", "images").find().toArray()).toEqual(
			SEASON5.map((image) => ({
				...image,
				collection: "season5",
				tags: []
			}))
		);
		expect(
			await collection("gallery", "collections")
				.find({}, { projection: { _id: 0 } })
				.toArray()
		).toEqual([{ slug: "season5", title: "Season 5" }]);
		expect(await collection("downloads", "items").find().toArray()).toEqual(
			[{ ...WORLD, collection: "spawn-worlds" }]
		);
		expect(
			await collection("downloads", "collections")
				.find({}, { projection: { _id: 0 } })
				.toArray()
		).toEqual([{ slug: "spawn-worlds", title: "Spawn Worlds" }]);
		// Kept without --drop-old.
		expect(await collectionNames("gallery")).toEqual([
			"collections",
			"images",
			"season5"
		]);
	});

	it("writes nothing on a dry run", async () => {
		await seedOldShape();

		const report = await migrateContentStorage(mongoose.connection, {
			...RUN,
			dryRun: true
		});

		expect(report.moved).toMatchObject([
			{ source: "season5", slug: "season5", documents: 2 },
			{ source: "Spawn_Worlds", slug: "spawn-worlds", documents: 1 }
		]);
		expect(await collection("gallery", "images").countDocuments()).toBe(0);
		expect(
			await collection("gallery", "collections").countDocuments()
		).toBe(0);
	});

	it("skips what an earlier run moved", async () => {
		await seedOldShape();
		await migrateContentStorage(mongoose.connection, RUN);

		const report = await migrateContentStorage(mongoose.connection, RUN);

		expect(report.moved[0]).toMatchObject({
			documents: 2,
			alreadyMoved: 2
		});
		expect(await collection("gallery", "images").countDocuments()).toBe(2);
		expect(
			await collection("gallery", "collections").countDocuments()
		).toBe(1);
	});

	it("drops the old collections with --drop-old once they're moved", async () => {
		await seedOldShape();

		const report = await migrateContentStorage(mongoose.connection, {
			...RUN,
			dropOld: true
		});

		expect(report.moved.every(({ dropped }) => dropped)).toBe(true);
		expect(await collectionNames("gallery")).toEqual([
			"collections",
			"images"
		]);
		expect(await collection("gallery", "images").countDocuments()).toBe(2);
	});

	it("writes nothing when two collections share a slug", async () => {
		await Promise.all([
			collection("gallery", "season-5").insertOne({ caption: "a" }),
			collection("gallery", "Season_5").insertOne({ caption: "b" })
		]);

		const report = await migrateContentStorage(mongoose.connection, RUN);

		expect(report.problems).toEqual([
			"gallery: Season_5, season-5 share the slug 'season-5'; rename one"
		]);
		expect(await collection("gallery", "images").countDocuments()).toBe(0);
	});

	it("writes nothing when an _id is in two collections", async () => {
		const _id = new Types.ObjectId();
		await Promise.all([
			collection("gallery", "a").insertOne({ _id, caption: "a" }),
			collection("gallery", "b").insertOne({ _id, caption: "b" })
		]);

		const report = await migrateContentStorage(mongoose.connection, RUN);

		expect(report.problems).toEqual([
			`gallery: _id ${_id.toHexString()} is in both a and b`
		]);
		expect(report.moved).toEqual([]);
	});

	it("reports map seasons stored twice", async () => {
		// As before the server built its unique index.
		await collection("maps", "seasons").dropIndexes();
		await collection("maps", "seasons").insertMany([
			{ season: 6 },
			{ season: 6 }
		]);

		const report = await migrateContentStorage(mongoose.connection, RUN);

		expect(report.problems).toEqual([
			"maps.seasons: season 6 is stored more than once; keep one"
		]);
	});
});
