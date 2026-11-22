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
import { EDITOR, sessionCookie } from "../../../test/session.ts";

beforeAll(startDatabase);
afterEach(async () => {
	vi.useRealTimers();
	await clearDatabase();
});
afterAll(stopDatabase);

const IMAGE = "https://i.ibb.co/abc/banner.png";
const PAST = new Date("2026-01-01T00:00:00.000Z");
const IN_A_DAY = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

let editor: Awaited<ReturnType<typeof asEditor>>;
beforeEach(async () => {
	editor = await asEditor();
});

const posts = () => collection("news", "posts");

function newPost(fields: object = {}) {
	return {
		createId: randomUUID(),
		title: "A *new* season",
		content: "Season 8 starts **now**.",
		imageUrl: IMAGE,
		...fields
	};
}

// A stored post, live since PAST unless fields say otherwise.
async function seedPost(fields: object = {}) {
	const _id = new Types.ObjectId();
	await posts().insertOne({
		_id,
		title: "Live",
		content: "Old text",
		date: PAST,
		...fields
	});
	return _id.toHexString();
}

describe("editor writes, refused", () => {
	const id = new Types.ObjectId().toHexString();

	it.each([
		["post", "/editor/news"],
		["patch", `/editor/news/${id}`],
		["delete", `/editor/news/${id}?startingRevision=0`],
		["post", "/editor/gallery/collections"],
		["patch", "/editor/gallery/collections/season5"],
		["delete", "/editor/downloads/collections/worlds?startingRevision=0"],
		["post", "/editor/maps/seasons"]
	] as const)(
		"answer %s %s with 401 when logged out",
		async (method, url) => {
			const res = await request(app)
				[method](url)
				.set("Origin", testConfig.FRONTEND_URL)
				.expect(401);

			expect(res.body).toEqual({ error: "ERROR: not logged in" });
		}
	);

	it.each([
		["post", "/editor/news"],
		["patch", `/editor/news/${id}`],
		["delete", `/editor/news/${id}?startingRevision=0`]
	] as const)(
		"answer %s %s with 403 without the website's Origin",
		async (method, url) => {
			await request(app)
				[method](url)
				.set("Cookie", await sessionCookie())
				.expect(403);
		}
	);

	it("lets browsers send PATCH and DELETE", async () => {
		const res = await request(app).options("/editor/news").expect(204);

		expect(res.headers["access-control-allow-methods"]).toBe(
			"GET,POST,PATCH,DELETE,OPTIONS"
		);
	});
});

describe("POST /editor/news", () => {
	it("creates a live post at revision 1, dated now", async () => {
		const before = await mongoManager.getContentVersion();
		const body = newPost();

		const res = await editor.post("/editor/news", body).expect(201);

		expect(res.body).toMatchObject({
			title: body.title,
			content: body.content,
			imageUrl: IMAGE,
			visible: true,
			revision: 1,
			status: "live",
			createdBy: EDITOR,
			lastUpdatedBy: EDITOR
		});
		expect(Date.now() - Date.parse(res.body.date)).toBeLessThan(5000);
		expect(res.body.createdAt).toBeDefined();
		expect(res.body).not.toHaveProperty("createId");
		const [stored] = await posts().find().toArray();
		expect(stored).toMatchObject({
			createId: body.createId,
			wasPublic: true
		});
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("returns the same post for a repeated createId", async () => {
		const body = newPost();
		const first = await editor.post("/editor/news", body).expect(201);

		const repeat = await editor
			.post("/editor/news", { ...body, title: "Changed" })
			.expect(200);

		expect(repeat.body).toEqual(first.body);
		expect(await posts().countDocuments()).toBe(1);
	});

	it("returns a repeat's post, and changes the version, without checking it again", async () => {
		const body = newPost();
		await editor.post("/editor/news", body).expect(201);
		const before = await mongoManager.getContentVersion();

		// A date in the past is refused now, but the post already exists.
		await editor
			.post("/editor/news", { ...body, date: "2020-01-01T00:00:00Z" })
			.expect(200);

		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("schedules a post with a future date, or hides one", async () => {
		const date = IN_A_DAY().toISOString();

		const [scheduled, hidden] = await Promise.all([
			editor.post("/editor/news", newPost({ date })).expect(201),
			editor.post("/editor/news", newPost({ visible: false })).expect(201)
		]);

		expect(scheduled.body).toMatchObject({ date, status: "scheduled" });
		expect(hidden.body).toMatchObject({ visible: false, status: "hidden" });
		expect(await posts().countDocuments({ wasPublic: false })).toBe(2);
	});

	it.each([
		[
			"a past date",
			{ date: "2020-01-01T00:00:00.000Z" },
			/date: must be now/
		],
		["raw HTML", { content: "<script>x</script>" }, /content: raw HTML/],
		["no createId", { createId: undefined }, /createId/],
		["a bad image URL", { imageUrl: "https://x.example/a.png" }, /imageUrl/]
	])("refuses %s with 400", async (_name, fields, message) => {
		const res = await editor
			.post("/editor/news", newPost(fields))
			.expect(400);

		expect(res.body.error).toMatch(message);
		expect(await posts().countDocuments()).toBe(0);
	});
});

describe("PATCH /editor/news/:id", () => {
	it("updates the fields sent, from the current revision", async () => {
		const id = await seedPost({ revision: 2, imageUrl: IMAGE });
		const before = await mongoManager.getContentVersion();

		const res = await editor
			.patch(`/editor/news/${id}`, {
				startingRevision: 2,
				title: "New title",
				imageUrl: null
			})
			.expect(200);

		expect(res.body).toMatchObject({
			id,
			title: "New title",
			content: "Old text",
			date: PAST.toISOString(),
			revision: 3,
			lastUpdatedBy: EDITOR
		});
		expect(res.body).not.toHaveProperty("imageUrl");
		expect(res.body.editedAt).toBeDefined();
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("counts a missing revision as 0", async () => {
		const id = await seedPost();

		const res = await editor
			.patch(`/editor/news/${id}`, {
				startingRevision: 0,
				content: "New"
			})
			.expect(200);

		expect(res.body.revision).toBe(1);
	});

	it("doesn't set editedAt on a post that's never been public", async () => {
		const id = await seedPost({ visible: false, revision: 1 });

		const res = await editor
			.patch(`/editor/news/${id}`, {
				startingRevision: 1,
				content: "New"
			})
			.expect(200);

		expect(res.body).not.toHaveProperty("editedAt");
	});

	it("keeps a live post's original date, and refuses another past one", async () => {
		const id = await seedPost({ revision: 1 });

		await editor
			.patch(`/editor/news/${id}`, {
				startingRevision: 1,
				date: PAST.toISOString()
			})
			.expect(200);
		const res = await editor
			.patch(`/editor/news/${id}`, {
				startingRevision: 2,
				date: "2025-06-01T00:00:00.000Z"
			})
			.expect(400);

		expect(res.body.error).toMatch(/date: must be now/);
	});

	it("answers 409 with the current post when the revision is stale", async () => {
		const id = await seedPost({ revision: 4, title: "Saved elsewhere" });

		const res = await editor
			.patch(`/editor/news/${id}`, { startingRevision: 3, title: "Mine" })
			.expect(409);

		expect(res.body).toEqual({
			error: `ERROR: news post '${id}' changed since you read it`,
			current: expect.objectContaining({
				id,
				title: "Saved elsewhere",
				revision: 4
			})
		});
		expect(await posts().findOne()).toMatchObject({
			title: "Saved elsewhere"
		});
	});

	it("answers 404 for a missing post", async () => {
		const id = new Types.ObjectId().toHexString();

		await editor
			.patch(`/editor/news/${id}`, { startingRevision: 0, title: "x" })
			.expect(404);
	});

	it("needs a startingRevision", async () => {
		const id = await seedPost();

		const res = await editor
			.patch(`/editor/news/${id}`, { title: "x" })
			.expect(400);

		expect(res.body.error).toMatch(/startingRevision/);
	});
});

describe("DELETE /editor/news/:id", () => {
	it("deletes the post at the current revision", async () => {
		const id = await seedPost({ revision: 2 });
		const before = await mongoManager.getContentVersion();

		await editor
			.delete(`/editor/news/${id}?startingRevision=2`)
			.expect(204);

		expect(await posts().countDocuments()).toBe(0);
		expect(await mongoManager.getContentVersion()).not.toBe(before);
	});

	it("answers 409 for a stale revision, deleting nothing", async () => {
		const id = await seedPost({ revision: 2 });
		const before = await mongoManager.getContentVersion();

		const res = await editor
			.delete(`/editor/news/${id}?startingRevision=1`)
			.expect(409);

		expect(res.body.current).toMatchObject({ id, revision: 2 });
		expect(await posts().countDocuments()).toBe(1);
		expect(await mongoManager.getContentVersion()).toBe(before);
	});

	it("answers 404 for a missing post", async () => {
		const id = new Types.ObjectId().toHexString();

		await editor
			.delete(`/editor/news/${id}?startingRevision=0`)
			.expect(404);
	});

	it.each(["", "?startingRevision=abc", "?startingRevision=-1"])(
		"answers 400 without a valid revision (%s)",
		async (query) => {
			const id = await seedPost();

			await editor.delete(`/editor/news/${id}${query}`).expect(400);
		}
	);
});

describe("gallery images", () => {
	beforeEach(async () => {
		await collection("gallery", "collections").insertOne({
			slug: "season5",
			title: "Season 5"
		});
	});

	it("creates an image with normalised tags", async () => {
		const res = await editor
			.post("/editor/gallery/images", {
				createId: randomUUID(),
				collection: "season5",
				caption: "Spawn",
				imageUrl: IMAGE,
				tags: ["Spawn", " build", "spawn"]
			})
			.expect(201);

		expect(res.body).toMatchObject({
			collection: "season5",
			tags: ["build", "spawn"],
			status: "live"
		});
	});

	it("refuses a collection that doesn't exist", async () => {
		const res = await editor
			.post("/editor/gallery/images", {
				createId: randomUUID(),
				collection: "missing",
				caption: "x",
				imageUrl: IMAGE
			})
			.expect(400);

		expect(res.body.error).toBe("ERROR: collection: no such collection");
	});

	it("moves an image to another existing collection", async () => {
		await collection("gallery", "collections").insertOne({
			slug: "season6",
			title: "Season 6"
		});
		const { insertedId } = await collection("gallery", "images").insertOne({
			collection: "season5",
			caption: "c",
			imageUrl: IMAGE
		});

		const res = await editor
			.patch(`/editor/gallery/images/${insertedId.toHexString()}`, {
				startingRevision: 0,
				collection: "season6"
			})
			.expect(200);

		expect(res.body.collection).toBe("season6");
	});
});

describe("map seasons", () => {
	function newSeason(season: number) {
		return {
			createId: randomUUID(),
			season,
			imageUrl: IMAGE,
			dimensions: [
				{
					name: "overworld",
					imageUrl: IMAGE,
					worldId: `s${season}_overworld`,
					perspective: ":0:0:0:1500:0:0:0:0:"
				}
			]
		};
	}

	it("creates a season with its dimensions", async () => {
		const res = await editor
			.post("/editor/maps/seasons", newSeason(8))
			.expect(201);

		expect(res.body).toMatchObject({
			season: 8,
			dimensions: [{ name: "overworld", worldId: "s8_overworld" }]
		});
	});

	it("answers 409 for a season that already exists", async () => {
		await editor.post("/editor/maps/seasons", newSeason(8)).expect(201);

		const res = await editor
			.post("/editor/maps/seasons", newSeason(8))
			.expect(409);

		expect(res.body).toEqual({
			error: "ERROR: a map season with that season already exists"
		});
	});

	it("answers 409 for an update to a taken season", async () => {
		await editor.post("/editor/maps/seasons", newSeason(8)).expect(201);
		const nine = await editor
			.post("/editor/maps/seasons", newSeason(9))
			.expect(201);

		await editor
			.patch(`/editor/maps/seasons/${nine.body.id}`, {
				startingRevision: 1,
				season: 8
			})
			.expect(409);
	});
});

describe("collections", () => {
	const collections = () => collection("downloads", "collections");

	it("creates a collection at revision 1", async () => {
		const res = await editor
			.post("/editor/downloads/collections", {
				slug: "worlds",
				title: "Worlds"
			})
			.expect(201);

		expect(res.body).toMatchObject({
			slug: "worlds",
			title: "Worlds",
			visible: true,
			revision: 1,
			itemCount: 0,
			createdBy: EDITOR
		});
	});

	it("answers 409 for a taken slug", async () => {
		await collections().insertOne({ slug: "worlds", title: "W" });

		const res = await editor
			.post("/editor/downloads/collections", {
				slug: "worlds",
				title: "Other"
			})
			.expect(409);

		expect(res.body.error).toMatch(/slug already exists/);
	});

	it("renames and hides a collection, keeping its slug", async () => {
		await collections().insertOne({ slug: "worlds", title: "W" });

		const res = await editor
			.patch("/editor/downloads/collections/worlds", {
				startingRevision: 0,
				title: "Worlds",
				visible: false,
				slug: "ignored"
			})
			.expect(200);

		expect(res.body).toMatchObject({
			slug: "worlds",
			title: "Worlds",
			visible: false,
			revision: 1
		});
	});

	it("deletes a collection with every item in it", async () => {
		await Promise.all([
			collections().insertOne({
				slug: "worlds",
				title: "W",
				revision: 2
			}),
			collection("downloads", "items").insertMany([
				{ collection: "worlds", title: "a" },
				{ collection: "worlds", title: "b" },
				{ collection: "other", title: "c" }
			])
		]);

		await editor
			.delete("/editor/downloads/collections/worlds?startingRevision=2")
			.expect(204);

		expect(await collections().countDocuments()).toBe(0);
		expect(
			await collection("downloads", "items")
				.find({}, { projection: { _id: 0, title: 1 } })
				.toArray()
		).toEqual([{ title: "c" }]);
	});

	it("deletes nothing for a stale revision", async () => {
		await Promise.all([
			collections().insertOne({
				slug: "worlds",
				title: "W",
				revision: 2
			}),
			collection("downloads", "items").insertOne({ collection: "worlds" })
		]);

		const res = await editor
			.delete("/editor/downloads/collections/worlds?startingRevision=1")
			.expect(409);

		expect(res.body.current).toMatchObject({
			slug: "worlds",
			revision: 2,
			itemCount: 1
		});
		expect(await collection("downloads", "items").countDocuments()).toBe(1);
	});

	it("answers 404 for a missing collection", async () => {
		await editor
			.patch("/editor/gallery/collections/missing", {
				startingRevision: 0
			})
			.expect(404);
	});
});
