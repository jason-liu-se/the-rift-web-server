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
import mongoose, { Types } from "mongoose";
import { MAX_TAGS_PER_IMAGE } from "../../config/content-limits.ts";
import { MAX_BULK_ITEMS } from "../../config/requests.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { app, testConfig } from "../../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { raceCreateWithDelete } from "../../../test/create-race.ts";
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

describe("/editor/<items>/bulk", () => {
	it("answers 401 logged out and 403 without the website's Origin", async () => {
		await request(app)
			.patch("/editor/news/bulk")
			.set("Origin", testConfig.FRONTEND_URL)
			.expect(401);
		await request(app).patch("/editor/news/bulk").expect(403);
	});

	it("hides every item, reporting each outcome in one response", async () => {
		const [a, b] = await seedImages(1, 2);
		const missing = new Types.ObjectId().toHexString();
		const before = await mongoManager.getContentVersion();

		const res = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "hide",
				items: [
					{ id: a, startingRevision: 1 },
					{ id: b, startingRevision: 1 },
					{ id: missing, startingRevision: 0 },
					{ id: "not-an-id", startingRevision: 0 }
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

	it.each([
		[
			"update",
			"patch",
			(ids: string[]) => ({
				action: "hide",
				items: [
					{ id: ids[0], startingRevision: 0 },
					{
						id: new Types.ObjectId().toHexString(),
						startingRevision: 1
					},
					{ id: "not-an-id", startingRevision: 1 }
				]
			}),
			["conflict", "not-found", "invalid"]
		],
		[
			"delete",
			"delete",
			(ids: string[]) => ({
				items: [
					{ id: ids[0], startingRevision: 0 },
					{
						id: new Types.ObjectId().toHexString(),
						startingRevision: 1
					},
					{ id: "not-an-id", startingRevision: 1 }
				]
			}),
			["conflict", "not-found", "invalid"]
		],
		[
			"create",
			"post",
			() => ({
				items: [
					{
						createId: randomUUID(),
						collection: "season5",
						caption: "x",
						imageUrl: "nope"
					},
					{
						createId: randomUUID(),
						collection: "missing",
						caption: "y",
						imageUrl: IMAGE
					}
				]
			}),
			["invalid", "invalid"]
		]
	] as const)(
		"keeps the version when every item of a bulk %s fails",
		async (_name, method, body, outcomes) => {
			const ids = await seedImages(1);
			const before = await mongoManager.getContentVersion();
			const stored = await images().find().toArray();

			const res = await editor[method](
				"/editor/gallery/images/bulk",
				body(ids)
			).expect(200);

			expect(
				res.body.results.map(
					({ outcome }: { outcome: string }) => outcome
				)
			).toEqual(outcomes);
			expect(await images().find().toArray()).toEqual(stored);
			expect(await mongoManager.getContentVersion()).toBe(before);
		}
	);

	it("writes the good items between failing ones, reporting each in order", async () => {
		const [a, b, c, d] = await seedImages(1, 1, 1, 1);
		const missing = new Types.ObjectId().toHexString();
		const before = await mongoManager.getContentVersion();

		const res = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "hide",
				items: [
					{ id: a, startingRevision: 1 },
					{ id: b, startingRevision: 0 },
					{ id: c, startingRevision: 1 },
					{ id: missing, startingRevision: 1 },
					{ id: d, startingRevision: 1 },
					{ id: "not-an-id", startingRevision: 1 }
				]
			})
			.expect(200);

		expect(
			res.body.results.map(({ id, outcome }: Record<string, string>) => [
				id,
				outcome
			])
		).toEqual([
			[a, "ok"],
			[b, "conflict"],
			[c, "ok"],
			[missing, "not-found"],
			[d, "ok"],
			["not-an-id", "invalid"]
		]);
		const hidden = await images().find({ visible: false }).toArray();
		expect(hidden.map(({ _id }) => _id.toHexString()).sort()).toEqual(
			[a, c, d].sort()
		);
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("creates the good images between failing ones, in order", async () => {
		const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
		const image = (
			createId: string,
			caption: string,
			imageUrl = IMAGE
		) => ({
			createId,
			collection: "season5",
			caption,
			imageUrl
		});

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				items: [
					image(ids[0] ?? "", "One"),
					image(ids[1] ?? "", "bad", "nope"),
					image(ids[2] ?? "", "Two"),
					image(ids[3] ?? "", "bad", "nope")
				]
			})
			.expect(200);

		expect(
			res.body.results.map(({ outcome }: { outcome: string }) => outcome)
		).toEqual(["ok", "invalid", "ok", "invalid"]);
		const stored = await images().find().sort({ _id: 1 }).toArray();
		expect(stored.map(({ caption }) => caption)).toEqual(["One", "Two"]);
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
			.patch("/editor/gallery/images/bulk", {
				action: "hide",
				items: [
					{ id: a, startingRevision: 1 },
					{ id: insertedId.toHexString(), startingRevision: 1 }
				]
			})
			.expect(500);

		expect(await images().countDocuments({ visible: false })).toBe(2);
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("deletes items at their revisions", async () => {
		const [a, b] = await seedImages(1, 1);

		const res = await editor
			.delete("/editor/gallery/images/bulk", {
				items: [
					{ id: a, startingRevision: 1 },
					{ id: b, startingRevision: 0 }
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

	it("writes an item sent twice once, the second a conflict", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "hide",
				items: [
					{ id: a, startingRevision: 1 },
					{ id: a, startingRevision: 1 }
				]
			})
			.expect(200);

		// Unordered, either copy may be written.
		expect(res.body.results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: a,
					outcome: "ok",
					item: expect.objectContaining({ revision: 2 })
				}),
				expect.objectContaining({
					id: a,
					outcome: "conflict",
					current: expect.objectContaining({ revision: 2 })
				})
			])
		);
		expect(await images().findOne()).toMatchObject({ revision: 2 });
	});

	it("deletes an item sent twice once, the second not found", async () => {
		const [a] = await seedImages(1);
		const missing = new Types.ObjectId().toHexString();

		const res = await editor
			.delete("/editor/gallery/images/bulk", {
				items: [
					{ id: a, startingRevision: 1 },
					{ id: a, startingRevision: 1 },
					{ id: missing, startingRevision: 1 }
				]
			})
			.expect(200);

		// Unordered, either copy may be deleted.
		expect(res.body.results.slice(0, 2)).toEqual(
			expect.arrayContaining([
				{ id: a, outcome: "ok" },
				{ id: a, outcome: "not-found" }
			])
		);
		expect(res.body.results[2]).toEqual({
			id: missing,
			outcome: "not-found"
		});
	});

	it("writes every item in one bulk write, however many", async () => {
		const ids = await seedImages(1, 1, 1, 1, 1);
		const bulkWrite = vi.spyOn(mongoose.Connection.prototype, "bulkWrite");
		const items = ids.map((id) => ({ id, startingRevision: 1 }));

		await editor
			.patch("/editor/gallery/images/bulk", { action: "hide", items })
			.expect(200);
		await editor
			.delete("/editor/gallery/images/bulk", {
				items: items.map(({ id }) => ({ id, startingRevision: 2 }))
			})
			.expect(200);

		expect(bulkWrite).toHaveBeenCalledTimes(2);
		expect(await images().countDocuments()).toBe(0);
	});

	it("moves images to another collection", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "move",
				collection: "season6",
				items: [{ id: a, startingRevision: 1 }]
			})
			.expect(200);

		expect(res.body.results[0].item.collection).toBe("season6");
	});

	it("refuses a move to a collection that doesn't exist", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "move",
				collection: "missing",
				items: [{ id: a, startingRevision: 1 }]
			})
			.expect(400);

		expect(res.body.error).toBe("ERROR: collection: no such collection");
	});

	it("adds and removes tags, normalised", async () => {
		const [a] = await seedImages(1);

		const added = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "add-tags",
				tags: ["Build", "spawn"],
				items: [{ id: a, startingRevision: 1 }]
			})
			.expect(200);
		const removed = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "remove-tags",
				tags: ["spawn"],
				items: [{ id: a, startingRevision: 2 }]
			})
			.expect(200);

		expect(added.body.results[0].item.tags).toEqual(["build", "spawn"]);
		expect(removed.body.results[0].item.tags).toEqual(["build"]);
	});

	it("reports an image that would get too many tags as invalid", async () => {
		const [a] = await seedImages(1);

		const res = await editor
			.patch("/editor/gallery/images/bulk", {
				action: "add-tags",
				tags: Array.from(
					{ length: MAX_TAGS_PER_IMAGE },
					(_, i) => `tag${i}`
				),
				items: [{ id: a, startingRevision: 1 }]
			})
			.expect(200);

		expect(res.body.results).toEqual([
			{
				id: a,
				outcome: "invalid",
				reason: `tags: at most ${MAX_TAGS_PER_IMAGE} tags`
			}
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
			items: [
				{
					createId: first,
					collection: "season5",
					caption: "One",
					imageUrl: IMAGE
				},
				{
					createId: second,
					collection: "season5",
					caption: "Two",
					imageUrl: IMAGE,
					tags: ["Spawn"],
					visible: false
				},
				{
					createId: bad,
					collection: "season5",
					caption: "x",
					imageUrl: "nope"
				},
				{
					createId: elsewhere,
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

	it("creates an image sent twice once, in one insert", async () => {
		const id = randomUUID();
		const image = {
			createId: id,
			collection: "season5",
			caption: "x",
			imageUrl: IMAGE
		};
		const insertMany = vi.spyOn(mongoose.Model, "insertMany");

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				items: [image, image]
			})
			.expect(200);

		const [first, second] = res.body.results;
		expect(first).toMatchObject({ id, outcome: "ok" });
		expect(second).toEqual(first);
		expect(await images().countDocuments()).toBe(1);
		expect(insertMany).toHaveBeenCalledTimes(1);
	});

	it("reports a repeated create whose image was deleted meanwhile as not found", async () => {
		const [raced, other] = [randomUUID(), randomUUID()];
		const image = (createId: string) => ({
			createId,
			collection: "season5",
			caption: "x",
			imageUrl: IMAGE
		});
		raceCreateWithDelete("gallery", "images", image(raced));

		const res = await editor
			.post("/editor/gallery/images/bulk", {
				items: [image(raced), image(other)]
			})
			.expect(200);

		expect(res.body.results).toEqual([
			{ id: raced, outcome: "not-found" },
			expect.objectContaining({ id: other, outcome: "ok" })
		]);
		expect(await images().countDocuments()).toBe(1);
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
			.patch("/editor/news/bulk", {
				action: "show",
				items: [{ id, startingRevision: 0 }]
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
			"patch",
			"/editor/news/bulk",
			{ action: "move", collection: "a", items: [{ id: "x" }] },
			/action/
		],
		[
			"a tag action outside the gallery",
			"patch",
			"/editor/downloads/items/bulk",
			{ action: "add-tags", tags: ["a"], items: [{ id: "x" }] },
			/action/
		],
		[
			"an unknown action",
			"patch",
			"/editor/news/bulk",
			{ action: "explode", items: [{ id: "x" }] },
			/action/
		],
		[
			"no items",
			"patch",
			"/editor/news/bulk",
			{ action: "hide", items: [] },
			/at least one item/
		],
		[
			"an item without an id",
			"patch",
			"/editor/news/bulk",
			{ action: "hide", items: [{ startingRevision: 0 }] },
			/id/
		],
		[
			"no tags",
			"patch",
			"/editor/gallery/images/bulk",
			{ action: "add-tags", tags: [], items: [{ id: "x" }] },
			/at least one tag/
		],
		[
			"a delete with no items",
			"delete",
			"/editor/gallery/images/bulk",
			{ items: [] },
			/at least one item/
		],
		[
			"a new item without a createId",
			"post",
			"/editor/gallery/images/bulk",
			{ items: [{ caption: "x" }] },
			/createId/
		]
	] as const)(
		"answers 400 for %s",
		async (_name, method, url, body, message) => {
			const res = await editor[method](url, body).expect(400);

			expect(res.body.error).toMatch(message);
		}
	);

	it("has no bulk create outside the gallery", async () => {
		await editor
			.post("/editor/downloads/items/bulk", {
				items: [{ createId: "x" }]
			})
			.expect(404);
	});

	it("answers 400 for more than MAX_BULK_ITEMS items", async () => {
		const items = Array.from({ length: MAX_BULK_ITEMS + 1 }, () => ({
			id: new Types.ObjectId().toHexString(),
			startingRevision: 0
		}));

		const res = await editor
			.patch("/editor/news/bulk", { action: "hide", items })
			.expect(400);

		expect(res.body.error).toContain(`at most ${MAX_BULK_ITEMS} items`);
	});
});
