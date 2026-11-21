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
import { EDITOR, sessionCookie } from "../../test/session.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const OTHER = { id: "456", username: "other" };
const CREATED = new Date("2026-01-02T00:00:00.000Z");
const LATER = new Date(Date.now() + 24 * 60 * 60 * 1000);

let cookie = "";
beforeAll(async () => {
	cookie = await sessionCookie();
});

function get(url: string) {
	return request(app).get(url).set("Cookie", cookie);
}

const NEWS = {
	live: {
		_id: new Types.ObjectId(),
		title: "Live post",
		date: new Date("2026-01-01T00:00:00.000Z"),
		content: "Season 8 is here",
		visible: true,
		revision: 2,
		createdBy: EDITOR,
		lastUpdatedBy: OTHER,
		createdAt: CREATED,
		updatedAt: CREATED
	},
	scheduled: {
		_id: new Types.ObjectId(),
		title: "Scheduled post",
		date: LATER,
		content: "Soon",
		createdBy: OTHER
	},
	// From before the editor tools: no visible, revision, or audit fields.
	old: {
		_id: new Types.ObjectId(),
		title: "Old post",
		date: new Date("2024-01-01T00:00:00.000Z"),
		content: "a.b"
	},
	hidden: {
		_id: new Types.ObjectId(),
		title: "Hidden post",
		date: new Date("2025-01-01T00:00:00.000Z"),
		content: "Draft-ish",
		visible: false,
		revision: 1
	}
};

function seedNews() {
	return collection("news", "posts").insertMany(
		Object.values(NEWS).map((post) => ({ ...post }))
	);
}

function titles(body: { items: { title: string }[] }): string[] {
	return body.items.map(({ title }) => title);
}

describe("editor reads, logged out", () => {
	it.each([
		"/editor/news",
		`/editor/news/${NEWS.live._id.toHexString()}`,
		"/editor/gallery/collections",
		"/editor/gallery/images",
		"/editor/downloads/collections",
		"/editor/downloads/items",
		"/editor/maps/seasons"
	])("answers GET %s with 401", async (url) => {
		const res = await request(app).get(url).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
	});
});

describe("GET /editor/news", () => {
	it("returns every post, public or not, newest first, with its status but not its content", async () => {
		await seedNews();

		const res = await get("/editor/news").expect(200);

		expect(res.body.total).toBe(4);
		expect(res.body.items).toEqual([
			{
				id: NEWS.scheduled._id.toHexString(),
				title: "Scheduled post",
				date: LATER.toISOString(),
				visible: true,
				revision: 0,
				status: "scheduled",
				createdBy: OTHER
			},
			{
				id: NEWS.live._id.toHexString(),
				title: "Live post",
				date: "2026-01-01T00:00:00.000Z",
				visible: true,
				revision: 2,
				status: "live",
				createdBy: EDITOR,
				lastUpdatedBy: OTHER,
				createdAt: CREATED.toISOString(),
				updatedAt: CREATED.toISOString()
			},
			expect.objectContaining({ title: "Hidden post", status: "hidden" }),
			expect.objectContaining({
				title: "Old post",
				visible: true,
				revision: 0,
				status: "live"
			})
		]);
	});

	it.each([
		["live", ["Live post", "Old post"]],
		["scheduled", ["Scheduled post"]],
		["hidden", ["Hidden post"]]
	])("filters by status (%s)", async (status, expected) => {
		await seedNews();

		const res = await get(`/editor/news?status=${status}`).expect(200);

		expect(titles(res.body)).toEqual(expected);
		expect(res.body.total).toBe(expected.length);
	});

	it("filters to the caller's own posts", async () => {
		await seedNews();

		const res = await get("/editor/news?mine=true").expect(200);

		expect(titles(res.body)).toEqual(["Live post"]);
	});

	it.each([
		["q=SEASON", ["Live post"]],
		[
			"q=post&in=title",
			["Scheduled post", "Live post", "Hidden post", "Old post"]
		],
		["q=post&in=content", []],
		// Regex characters match themselves.
		["q=a.b", ["Old post"]],
		["q=a*", []]
	])("searches (%s)", async (query, expected) => {
		await seedNews();

		const res = await get(`/editor/news?${query}`).expect(200);

		expect(titles(res.body)).toEqual(expected);
	});

	it("paginates, with the total of every match", async () => {
		await seedNews();

		const res = await get("/editor/news?startIndex=1&limit=2").expect(200);

		expect(titles(res.body)).toEqual(["Live post", "Hidden post"]);
		expect(res.body.total).toBe(4);
	});

	it.each([
		["status=draft", /status/],
		["in=caption", /in/],
		["mine=maybe", /mine/],
		[`q=${"a".repeat(101)}`, /q must be at most 100 characters/],
		["limit=101", /limit/],
		["limit=0", /limit/],
		["startIndex=-1", /startIndex/],
		// Express's simple query parser never makes objects (`q[$ne]` is just
		// an unknown key), but a repeated key is an array, which never reaches
		// a query either.
		["q=a&q=b", /q/],
		["status=live&status=hidden", /status/]
	])("rejects %s", async (query, message) => {
		const res = await get(`/editor/news?${query}`).expect(400);

		expect(res.body.error).toMatch(message);
	});

	it("returns an empty page past the end", async () => {
		await seedNews();

		const res = await get("/editor/news?startIndex=10").expect(200);

		expect(res.body).toEqual({ items: [], total: 4 });
	});

	it("may be cached privately, but only after revalidating", async () => {
		await seedNews();
		const first = await get("/editor/news").expect(200);

		expect(first.headers["cache-control"]).toBe("private, no-cache");
		expect(first.headers).not.toHaveProperty("cdn-cache-control");

		await request(app)
			.get("/editor/news")
			.set("Cookie", await sessionCookie())
			.set("If-None-Match", first.headers["etag"] ?? "")
			.expect(304);
	});
});

describe("GET /editor/news/:id", () => {
	it("returns one post, even a hidden one", async () => {
		await seedNews();

		const res = await get(
			`/editor/news/${NEWS.hidden._id.toHexString()}`
		).expect(200);

		expect(res.body).toMatchObject({
			id: NEWS.hidden._id.toHexString(),
			content: "Draft-ish",
			status: "hidden",
			revision: 1
		});
	});

	it("answers 404 for a missing post", async () => {
		const id = new Types.ObjectId().toHexString();

		const res = await get(`/editor/news/${id}`).expect(404);

		expect(res.body).toEqual({
			error: `ERROR: news post '${id}' not found`
		});
	});

	it("answers 400 for an invalid id", async () => {
		const res = await get("/editor/news/not-an-id").expect(400);

		expect(res.body.error).toMatch(/id: invalid id/);
	});
});

describe("GET /editor/gallery/images", () => {
	async function seedImages() {
		await collection("gallery", "images").insertMany([
			{
				collection: "season5",
				caption: "Spawn",
				imageUrl: "1.png",
				tags: ["spawn"]
			},
			{
				collection: "season6",
				caption: "Castle",
				imageUrl: "2.png",
				tags: ["build"],
				visible: false
			}
		]);
	}

	it("returns images from every collection, newest first", async () => {
		await seedImages();

		const res = await get("/editor/gallery/images").expect(200);

		expect(res.body.items).toMatchObject([
			{ caption: "Castle", collection: "season6", status: "hidden" },
			{ caption: "Spawn", collection: "season5", status: "live" }
		]);
	});

	it.each([
		["collection=season5", ["Spawn"]],
		["q=BUI&in=tags", ["Castle"]],
		["status=hidden", ["Castle"]]
	])("filters (%s)", async (query, captions) => {
		await seedImages();

		const res = await get(`/editor/gallery/images?${query}`).expect(200);

		expect(
			res.body.items.map(({ caption }: { caption: string }) => caption)
		).toEqual(captions);
	});

	it("has no scheduled status", async () => {
		await get("/editor/gallery/images?status=scheduled").expect(400);
	});
});

describe("GET /editor/downloads/items", () => {
	it("returns items in the public order", async () => {
		await collection("downloads", "items").insertMany([
			{
				collection: "worlds",
				title: "b",
				desc: "",
				downloadUrl: "u",
				imageUrl: "i"
			},
			{
				collection: "worlds",
				title: "z",
				desc: "",
				downloadUrl: "u",
				imageUrl: "i",
				sortOrder: 1
			}
		]);

		const res = await get("/editor/downloads/items").expect(200);

		expect(res.body.items).toMatchObject([
			{ title: "z", sortOrder: 1 },
			{ title: "b" }
		]);
		expect(res.body.items[0]).not.toHaveProperty("desc");
	});
});

describe("GET /editor/maps/seasons", () => {
	it.each([
		["q=7&in=season", [7]],
		["q=7", [7]],
		["q=nether&in=dimensions", [6]],
		["q=x&in=season", []]
	])("searches (%s)", async (query, seasons) => {
		await collection("maps", "seasons").insertMany([
			{
				season: 6,
				imageUrl: "i",
				dimensions: [
					{
						name: "nether",
						imageUrl: "i",
						worldId: "w",
						perspective: "p"
					}
				]
			},
			{ season: 7, imageUrl: "i", dimensions: [] }
		]);

		const res = await get(`/editor/maps/seasons?${query}`).expect(200);

		expect(
			res.body.items.map(({ season }: { season: number }) => season)
		).toEqual(seasons);
		for (const item of res.body.items) {
			expect(item).not.toHaveProperty("dimensions");
		}
	});
});

describe("GET /editor/gallery/collections", () => {
	it("returns every collection, public or not, with its item count", async () => {
		await Promise.all([
			collection("gallery", "collections").insertMany([
				{
					slug: "season6",
					title: "Season 6",
					visible: false,
					revision: 3
				},
				{ slug: "season5", title: "Season 5" }
			]),
			collection("gallery", "images").insertMany([
				{ collection: "season5", caption: "a", imageUrl: "a" },
				{
					collection: "season5",
					caption: "b",
					imageUrl: "b",
					visible: false
				}
			])
		]);

		const res = await get("/editor/gallery/collections").expect(200);

		expect(res.body).toEqual([
			{
				slug: "season5",
				title: "Season 5",
				visible: true,
				revision: 0,
				itemCount: 2
			},
			{
				slug: "season6",
				title: "Season 6",
				visible: false,
				revision: 3,
				itemCount: 0
			}
		]);
		expect(res.headers["cache-control"]).toBe("private, no-cache");
	});
});
