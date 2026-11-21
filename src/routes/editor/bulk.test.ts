import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { app, testConfig } from "../../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { asEditor } from "../../../test/editor.ts";
import { EDITOR } from "../../../test/session.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);
afterEach(() => {
	vi.restoreAllMocks();
});

const IMAGE = "https://i.ibb.co/abc/shot.png";

let editor: Awaited<ReturnType<typeof asEditor>>;
beforeEach(async () => {
	editor = await asEditor();
	await collection("gallery", "collections").insertMany([
		{ slug: "season5", title: "Season 5" },
		{ slug: "season6", title: "Season 6" }
	]);
});

const images = () => collection("gallery", "images");

// Stored images at the given revisions, returning their ids.
async function seedImages(...revisions: number[]): Promise<string[]> {
	const docs = revisions.map((revision) => ({
		_id: new Types.ObjectId(),
		collection: "season5",
		caption: `rev ${revision}`,
		imageUrl: IMAGE,
		tags: ["spawn"],
		revision
	}));
	await images().insertMany(docs);
	return docs.map(({ _id }) => _id.toHexString());
}

describe("POST /editor/<items>/bulk", () => {
	it("answers 401 logged out and 403 without the website's Origin", async () => {
		await request(app)
			.post("/editor/news/bulk")
			.set("Origin", testConfig.FRONTEND_URL)
			.expect(401);
		await request(app).post("/editor/news/bulk").expect(403);
	});

	it("hides every item, reporting each outcome in one response", async () => {
		const [a, b] = await seedImages(1, 2);
		const missing = new Types.ObjectId().toHexString();
		const before = await mongoManager.getContentVersion();

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				action: "hide",
				items: [
					{ id: a, revision: 1 },
					{ id: b, revision: 1 },
					{ id: missing, revision: 0 },
					{ id: "not-an-id", revision: 0 }
				]
			})
			.expect(200);

		expect(res.body.results).toEqual([
			{
				id: a,
				outcome: "ok",
				item: expect.objectContaining({
					visible: false,
					status: "hidden",
					revision: 2,
					lastUpdatedBy: EDITOR
				})
			},
			{
				id: b,
				outcome: "conflict",
				current: expect.objectContaining({ id: b, revision: 2 })
			},
			{ id: missing, outcome: "not-found" },
			{ id: "not-an-id", outcome: "invalid", reason: "id: invalid id" }
		]);
		expect(await images().countDocuments({ visible: false })).toBe(1);
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("changes the version even when an item fails after others were written", async () => {
		const [a] = await seedImages(1);
		// Breaks the contract, so its result fails once it's written.
		const { insertedId } = await images().insertOne({
			collection: "season5",
			caption: "no image URL",
			revision: 1
		});
		const before = await mongoManager.getContentVersion();
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await editor
			.post("/editor/gallery/images/bulk", {
				action: "hide",
				items: [
					{ id: a, revision: 1 },
					{ id: insertedId.toHexString(), revision: 1 }
				]
			})
			.expect(500);

		expect(await images().countDocuments({ visible: false })).toBe(2);
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("deletes items at their revisions", async () => {
		const [a, b] = await seedImages(1, 1);

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				action: "delete",
				items: [
					{ id: a, revision: 1 },
					{ id: b, revision: 0 }
				]
			})
			.expect(200);

		expect(res.body.results).toMatchObject([
			{ id: a, outcome: "ok" },
			{ id: b, outcome: "conflict" }
		]);
		expect(res.body.results[0]).not.toHaveProperty("item");
		expect(await images().countDocuments()).toBe(1);
	});

	it("moves images to another collection", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				action: "move",
				collection: "season6",
				items: [{ id: a, revision: 1 }]
			})
			.expect(200);

		expect(res.body.results[0].item.collection).toBe("season6");
	});

	it("refuses a move to a collection that doesn't exist", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				action: "move",
				collection: "missing",
				items: [{ id: a, revision: 1 }]
			})
			.expect(400);

		expect(res.body.error).toBe("ERROR: collection: no such collection");
	});

	it("adds and removes tags, normalised", async () => {
		const [a] = await seedImages(1);

		const added = await editor
			.post("/editor/gallery/images/bulk", {
				action: "add-tags",
				tags: ["Build", "spawn"],
				items: [{ id: a, revision: 1 }]
			})
			.expect(200);
		const removed = await editor
			.post("/editor/gallery/images/bulk", {
				action: "remove-tags",
				tags: ["spawn"],
				items: [{ id: a, revision: 2 }]
			})
			.expect(200);

		expect(added.body.results[0].item.tags).toEqual(["build", "spawn"]);
		expect(removed.body.results[0].item.tags).toEqual(["build"]);
	});

	it("reports an image that would get too many tags as invalid", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				action: "add-tags",
				tags: Array.from({ length: 10 }, (_, i) => `tag${i}`),
				items: [{ id: a, revision: 1 }]
			})
			.expect(200);

		expect(res.body.results).toEqual([
			{ id: a, outcome: "invalid", reason: "tags: at most 10 tags" }
		]);
	});

	it("creates gallery images in order, idempotently, reporting bad ones", async () => {
		const [first, second, bad, elsewhere] = [
			randomUUID(),
			randomUUID(),
			randomUUID(),
			randomUUID()
		];
		const body = {
			action: "create",
			items: [
				{
					id: first,
					collection: "season5",
					caption: "One",
					imageUrl: IMAGE
				},
				{
					id: second,
					collection: "season5",
					caption: "Two",
					imageUrl: IMAGE,
					tags: ["Spawn"],
					visible: false
				},
				{
					id: bad,
					collection: "season5",
					caption: "x",
					imageUrl: "nope"
				},
				{
					id: elsewhere,
					collection: "missing",
					caption: "y",
					imageUrl: IMAGE
				}
			]
		};

		const res = await editor
			.post("/editor/gallery/images/bulk", body)
			.expect(200);
		const repeat = await editor
			.post("/editor/gallery/images/bulk", body)
			.expect(200);

		expect(res.body.results).toEqual([
			{
				id: first,
				outcome: "ok",
				item: expect.objectContaining({ caption: "One", revision: 1 })
			},
			{
				id: second,
				outcome: "ok",
				item: expect.objectContaining({
					tags: ["spawn"],
					status: "hidden"
				})
			},
			{
				id: bad,
				outcome: "invalid",
				reason: "imageUrl: must start with an allowed image host"
			},
			{
				id: elsewhere,
				outcome: "invalid",
				reason: "collection: no such collection"
			}
		]);
		expect(repeat.body.results.slice(0, 2)).toEqual(
			res.body.results.slice(0, 2)
		);
		const stored = await images().find().sort({ _id: 1 }).toArray();
		expect(stored.map(({ caption }) => caption)).toEqual(["One", "Two"]);
	});

	it("shows news posts by the news rules", async () => {
		const { insertedId } = await collection("news", "posts").insertOne({
			title: "t",
			content: "c",
			date: new Date("2026-01-01"),
			visible: false
		});
		const id = insertedId.toHexString();

		const res = await editor
			.post("/editor/news/bulk", {
				action: "show",
				items: [{ id, revision: 0 }]
			})
			.expect(200);

		expect(res.body.results[0].item.status).toBe("live");
		expect(await collection("news", "posts").findOne()).toMatchObject({
			wasPublic: true
		});
	});

	it.each([
		[
			"an action another type has",
			"/editor/news/bulk",
			{ action: "move", collection: "a", items: [{ id: "x" }] },
			/action: move isn't available/
		],
		[
			"create outside the gallery",
			"/editor/downloads/items/bulk",
			{ action: "create", items: [{ id: "x" }] },
			/action: create isn't available/
		],
		[
			"an unknown action",
			"/editor/news/bulk",
			{ action: "explode", items: [{ id: "x" }] },
			/action/
		],
		[
			"no items",
			"/editor/news/bulk",
			{ action: "hide", items: [] },
			/at least one item/
		],
		[
			"an item without an id",
			"/editor/news/bulk",
			{ action: "hide", items: [{ revision: 0 }] },
			/id/
		],
		[
			"no tags",
			"/editor/gallery/images/bulk",
			{ action: "add-tags", tags: [], items: [{ id: "x" }] },
			/at least one tag/
		]
	])("answers 400 for %s", async (_name, url, body, message) => {
		const res = await editor.post(url, body).expect(400);

		expect(res.body.error).toMatch(message);
	});

	it("answers 400 for more than 100 items", async () => {
		const items = Array.from({ length: 101 }, () => ({
			id: new Types.ObjectId().toHexString(),
			revision: 0
		}));

		const res = await editor
			.post("/editor/news/bulk", { action: "hide", items })
			.expect(400);

		expect(res.body.error).toMatch(/at most 100 items/);
	});
});
