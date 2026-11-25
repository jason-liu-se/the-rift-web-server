import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import {
	MAX_DRAFTS_PER_USER,
	MAX_DRAFT_BYTES,
	MAX_NEWS_TITLE_LENGTH
} from "../../config/content-limits.ts";
import { app, testConfig } from "../../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { markPublished } from "../../managers/drafts.ts";
import { asEditor } from "../../../test/editor.ts";
import { EDITOR, sessionCookie } from "../../../test/session.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const IMAGE = "https://i.ibb.co/abc/banner.png";
const PAST = new Date("2026-01-01T00:00:00.000Z");
const OTHER = { id: "456", username: "other" };

let editor: Awaited<ReturnType<typeof asEditor>>;
let other: Awaited<ReturnType<typeof asEditor>>;
beforeEach(async () => {
	[editor, other] = await Promise.all([asEditor(), asEditor(OTHER)]);
});

const stored = () => collection("editor", "drafts");
const posts = () => collection("news", "posts");

function newsDraft(fields: object = {}) {
	return { type: "news", fields: { title: "Draft", ...fields } };
}

async function createDraft(body: object = newsDraft()) {
	const id = randomUUID();
	const res = await editor.put(`/editor/drafts/${id}`, body).expect(201);
	return { id, draft: res.body };
}

async function seedPost(fields: object = {}) {
	const { insertedId } = await posts().insertOne({
		title: "Live",
		content: "Old",
		date: PAST,
		revision: 3,
		...fields
	});
	return insertedId.toHexString();
}

describe("drafts, refused", () => {
	const id = randomUUID();

	it.each([
		["get", "/editor/drafts"],
		["get", `/editor/drafts/${id}`],
		["put", `/editor/drafts/${id}`],
		["delete", `/editor/drafts/${id}`],
		["post", `/editor/drafts/${id}/publish`]
	] as const)(
		"answer %s %s with 401 when logged out",
		async (method, url) => {
			await request(app)
				[method](url)
				.set("Origin", testConfig.FRONTEND_URL)
				.expect(401);
		}
	);

	it.each([
		["put", `/editor/drafts/${id}`],
		["delete", `/editor/drafts/${id}`],
		["post", `/editor/drafts/${id}/publish`]
	] as const)(
		"answer %s %s with 403 without the website's Origin",
		async (method, url) => {
			await request(app)
				[method](url)
				.set("Cookie", await sessionCookie())
				.expect(403);
		}
	);
});

describe("PUT /editor/drafts/:id", () => {
	it("creates a draft with missing fields, never cached", async () => {
		const id = randomUUID();

		const res = await editor
			.put(`/editor/drafts/${id}`, newsDraft({ content: "<b>wip</b>" }))
			.expect(201);

		expect(res.body).toEqual({
			id,
			type: "news",
			fields: { title: "Draft", content: "<b>wip</b>" },
			revision: 1,
			createdAt: expect.any(String),
			updatedAt: expect.any(String)
		});
		expect(res.headers["cache-control"]).toBe("no-store");
		expect(await stored().findOne()).toMatchObject({ owner: EDITOR.id });
	});

	it("saves from the draft's revision, and answers 409 to a stale save", async () => {
		const { id } = await createDraft();

		const saved = await editor
			.put(`/editor/drafts/${id}`, {
				...newsDraft({ title: "Two" }),
				startingRevision: 1
			})
			.expect(200);
		const stale = await editor
			.put(`/editor/drafts/${id}`, {
				...newsDraft({ title: "Old tab" }),
				startingRevision: 1
			})
			.expect(409);

		expect(saved.body).toMatchObject({
			revision: 2,
			fields: { title: "Two" }
		});
		expect(stale.body).toEqual({
			error: "ERROR: the draft was saved elsewhere since",
			current: expect.objectContaining({
				revision: 2,
				fields: { title: "Two" }
			})
		});
	});

	it("answers a repeated create with the draft already made, saving nothing", async () => {
		const { id, draft } = await createDraft(newsDraft({ title: "First" }));

		const res = await editor
			.put(`/editor/drafts/${id}`, newsDraft({ title: "Retry" }))
			.expect(200);

		expect(res.body).toEqual(draft);
	});

	it("keeps one edit draft per editor per item", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const { id: first } = await createDraft({ ...newsDraft(), target });

		const res = await editor
			.put(`/editor/drafts/${randomUUID()}`, { ...newsDraft(), target })
			.expect(409);
		await other
			.put(`/editor/drafts/${randomUUID()}`, { ...newsDraft(), target })
			.expect(201);

		expect(res.body.current).toMatchObject({ id: first, target });
	});

	it("answers 404 for an edit draft of a missing item", async () => {
		const target = {
			id: new Types.ObjectId().toHexString(),
			startingRevision: 0
		};

		await editor
			.put(`/editor/drafts/${randomUUID()}`, { ...newsDraft(), target })
			.expect(404);
	});

	it("answers 404 for another editor's draft ID", async () => {
		const { id } = await createDraft();

		const res = await other
			.put(`/editor/drafts/${id}`, {
				...newsDraft(),
				startingRevision: 1
			})
			.expect(404);

		expect(res.body).toEqual({ error: `ERROR: draft '${id}' not found` });
	});

	it.each([
		[
			"a field over its limit",
			newsDraft({ title: "a".repeat(MAX_NEWS_TITLE_LENGTH + 1) }),
			`title: must be at most ${MAX_NEWS_TITLE_LENGTH} characters`
		],
		["an unknown type", { type: "poll", fields: {} }, "type"],
		[
			// JSON escapes the character to six bytes: just past MAX_DRAFT_BYTES,
			// with the content within its own limit.
			"fields over MAX_DRAFT_BYTES",
			newsDraft({
				content: "\u0001".repeat(Math.floor(MAX_DRAFT_BYTES / 6) + 1)
			}),
			`fields: a draft holds at most ${MAX_DRAFT_BYTES / 1024} KB`
		]
	])("refuses %s", async (_name, body, message) => {
		const res = await editor
			.put(`/editor/drafts/${randomUUID()}`, body)
			.expect(400);

		expect(res.body.error).toContain(message);
	});

	it("keeps a change to only an item's visibility", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };

		const { draft } = await createDraft({
			type: "news",
			fields: { visible: false },
			target
		});

		expect(draft.fields).toEqual({ visible: false });
	});

	it("keeps a change to only a post's date", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const date = new Date(Date.now() + 86_400_000).toISOString();

		const { draft } = await createDraft({
			type: "news",
			fields: { date },
			target
		});

		expect(draft.fields).toEqual({ date });
	});

	it("refuses a news draft's date that isn't a date", async () => {
		const res = await editor
			.put(`/editor/drafts/${randomUUID()}`, {
				type: "news",
				fields: { date: "tomorrow" }
			})
			.expect(400);

		expect(res.body.error).toContain('must be "now" or an ISO date-time');
	});

	it("refuses changing a draft's type", async () => {
		const { id } = await createDraft();

		await editor
			.put(`/editor/drafts/${id}`, {
				type: "gallery",
				fields: {},
				startingRevision: 1
			})
			.expect(400);
	});

	it("refuses a draft past the per-editor cap", async () => {
		await stored().insertMany(
			Array.from({ length: MAX_DRAFTS_PER_USER }, () => ({
				_id: randomUUID() as never,
				owner: EDITOR.id,
				type: "news",
				fields: {},
				revision: 1
			}))
		);

		const res = await editor
			.put(`/editor/drafts/${randomUUID()}`, newsDraft())
			.expect(400);

		expect(res.body.error).toContain(
			`you have ${MAX_DRAFTS_PER_USER} drafts`
		);
	});
});

describe("GET /editor/drafts", () => {
	it("lists only the caller's drafts, newest save first, by type", async () => {
		const { id: older } = await createDraft();
		const { id: newer } = await createDraft();
		await createDraft({ type: "gallery", fields: { caption: "c" } });
		await other
			.put(`/editor/drafts/${randomUUID()}`, newsDraft())
			.expect(201);

		const res = await editor.get("/editor/drafts?type=news").expect(200);

		expect(res.body.map(({ id }: { id: string }) => id)).toEqual([
			newer,
			older
		]);
		expect(res.headers["cache-control"]).toBe("no-store");
	});

	it("lists only what names each draft and its image, not the rest of its fields", async () => {
		const { id } = await createDraft(
			newsDraft({ content: "Long body", imageUrl: IMAGE })
		);

		const res = await editor.get("/editor/drafts").expect(200);

		expect(res.body).toEqual([
			{
				id,
				type: "news",
				fields: { title: "Draft", imageUrl: IMAGE },
				revision: 1,
				createdAt: expect.any(String),
				updatedAt: expect.any(String)
			}
		]);
	});

	it("lists a gallery draft's tags, for the tag filter", async () => {
		const { id } = await createDraft({
			type: "gallery",
			fields: { caption: "c", tags: ["night"] }
		});

		const res = await editor.get("/editor/drafts").expect(200);

		expect(res.body).toEqual([
			expect.objectContaining({
				id,
				fields: { caption: "c", tags: ["night"] }
			})
		]);
	});

	it("lists the collection a gallery or download draft is in", async () => {
		const gallery = await createDraft({
			type: "gallery",
			fields: { collection: "season5", caption: "c" }
		});
		const download = await createDraft({
			type: "downloads",
			fields: { collection: "packs", title: "t", desc: "Long" }
		});

		const res = await editor.get("/editor/drafts").expect(200);

		expect(res.body).toEqual([
			expect.objectContaining({
				id: download.id,
				fields: { collection: "packs", title: "t" }
			}),
			expect.objectContaining({
				id: gallery.id,
				fields: { collection: "season5", caption: "c" }
			})
		]);
	});

	it("counts a map season draft's dimensions instead of listing them", async () => {
		const dimension = {
			name: "Overworld",
			imageUrl: IMAGE,
			worldId: "world",
			perspective: ""
		};
		const { id: some } = await createDraft({
			type: "maps",
			fields: { season: 6, dimensions: [dimension, dimension] }
		});
		const { id: none } = await createDraft({
			type: "maps",
			fields: { season: 7 }
		});

		const res = await editor.get("/editor/drafts?type=maps").expect(200);

		expect(res.body).toEqual([
			expect.objectContaining({
				id: none,
				fields: { season: 7 },
				dimensionCount: 0
			}),
			expect.objectContaining({
				id: some,
				fields: { season: 6 },
				dimensionCount: 2
			})
		]);
	});

	it("answers 404 for another editor's draft", async () => {
		const { id } = await createDraft();

		await editor.get(`/editor/drafts/${id}`).expect(200);
		await other.get(`/editor/drafts/${id}`).expect(404);
	});
});

describe("DELETE /editor/drafts/:id", () => {
	it("deletes the caller's draft only", async () => {
		const { id } = await createDraft();

		await other.delete(`/editor/drafts/${id}`).expect(404);
		await editor.delete(`/editor/drafts/${id}`).expect(204);
		await editor.get(`/editor/drafts/${id}`).expect(404);
	});

	it("answers 404 for a draft that doesn't exist", async () => {
		const id = randomUUID();

		const res = await editor.delete(`/editor/drafts/${id}`).expect(404);

		expect(res.body).toEqual({ error: `ERROR: draft '${id}' not found` });
	});
});

describe("POST /editor/drafts/:id/publish", () => {
	it("publishes a new post, creating it from the draft once", async () => {
		const { id } = await createDraft(
			newsDraft({ content: "Body", imageUrl: IMAGE })
		);

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);
		const repeat = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);

		expect(res.body).toMatchObject({
			title: "Draft",
			content: "Body",
			status: "live",
			revision: 1,
			createdBy: EDITOR
		});
		expect(repeat.body).toEqual(res.body);
		expect(await posts().countDocuments()).toBe(1);
		await editor.get(`/editor/drafts/${id}`).expect(404);
		expect((await editor.get("/editor/drafts").expect(200)).body).toEqual(
			[]
		);
	});

	it("marks only the revision it published, keeping a save made since", async () => {
		const { id } = await createDraft(newsDraft({ content: "Body" }));
		await editor
			.put(`/editor/drafts/${id}`, {
				...newsDraft({ title: "Newer" }),
				startingRevision: 1
			})
			.expect(200);

		// As a publish that read revision 1 would, after the save landed.
		await markPublished(EDITOR.id, id, 1, "item", new Date());

		expect(
			(await editor.get(`/editor/drafts/${id}`).expect(200)).body
		).toMatchObject({ revision: 2, fields: { title: "Newer" } });
	});

	it("checks the draft fully before publishing", async () => {
		const { id } = await createDraft(newsDraft({ content: "<b>x</b>" }));

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(400);

		expect(res.body.error).toMatch(/content: raw HTML/);
		await editor.get(`/editor/drafts/${id}`).expect(200);
	});

	it("schedules a new post or publishes it hidden", async () => {
		const date = new Date(Date.now() + 86_400_000).toISOString();
		const { id } = await createDraft(newsDraft({ content: "Body" }));

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true, date })
			.expect(200);

		expect(res.body).toMatchObject({ date, status: "scheduled" });
	});

	it("updates the item an edit draft started from, keeping its date", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const { id } = await createDraft({
			type: "news",
			fields: { title: "Edited", content: "New" },
			target
		});

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);

		expect(res.body).toMatchObject({
			id: target.id,
			title: "Edited",
			date: PAST.toISOString(),
			revision: 4,
			editedAt: expect.any(String)
		});
		expect(await stored().findOne()).toMatchObject({
			publishedAs: target.id
		});
	});

	it("answers 409 with the item when it changed since the draft started", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const { id } = await createDraft({
			type: "news",
			fields: { title: "Mine", content: "Mine" },
			target
		});
		await posts().updateOne({}, { $set: { title: "Theirs", revision: 4 } });

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(409);

		expect(res.body.current).toMatchObject({
			title: "Theirs",
			revision: 4
		});
		await editor.get(`/editor/drafts/${id}`).expect(200);
	});

	it("answers 404 when the item was deleted, then publishes it as new", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const { id } = await createDraft({
			type: "news",
			fields: { title: "Kept", content: "Kept" },
			target
		});
		await posts().deleteMany({});

		await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(404);
		const res = await editor
			.post(`/editor/drafts/${id}/publish`, {
				visible: false,
				asNew: true
			})
			.expect(200);

		expect(res.body).toMatchObject({ title: "Kept", status: "hidden" });
		expect(res.body.id).not.toBe(target.id);
	});

	it("answers 404 for another editor's draft", async () => {
		const { id } = await createDraft(newsDraft({ content: "Body" }));

		await other
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(404);
	});

	it("publishes the draft's visibility when publish doesn't send one", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const [edit, created] = await Promise.all([
			createDraft({
				type: "news",
				fields: { title: "Live", content: "Old", visible: false },
				target
			}),
			createDraft(newsDraft({ content: "Body", visible: false }))
		]);

		const [editRes, createdRes] = await Promise.all([
			editor.post(`/editor/drafts/${edit.id}/publish`, {}).expect(200),
			editor.post(`/editor/drafts/${created.id}/publish`, {}).expect(200)
		]);

		expect(editRes.body).toMatchObject({ id: target.id, visible: false });
		expect(createdRes.body).toMatchObject({ visible: false });
	});

	it("publishes with publish's visible over the draft's", async () => {
		const { id } = await createDraft(
			newsDraft({ content: "Body", visible: false })
		);

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);

		expect(res.body).toMatchObject({ visible: true, status: "live" });
	});

	it("publishes the draft's date when publish doesn't send one", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const date = new Date(Date.now() + 86_400_000).toISOString();
		const [edit, created] = await Promise.all([
			createDraft({
				type: "news",
				fields: { title: "Live", content: "Old", date },
				target
			}),
			createDraft(newsDraft({ content: "Body", date }))
		]);

		const [editRes, createdRes] = await Promise.all([
			editor.post(`/editor/drafts/${edit.id}/publish`, {}).expect(200),
			editor.post(`/editor/drafts/${created.id}/publish`, {}).expect(200)
		]);

		expect(editRes.body).toMatchObject({
			id: target.id,
			date,
			status: "scheduled"
		});
		expect(createdRes.body).toMatchObject({ date, status: "scheduled" });
	});

	it("publishes with publish's date over the draft's", async () => {
		const later = new Date(Date.now() + 86_400_000).toISOString();
		const { id } = await createDraft(
			newsDraft({ content: "Body", date: later })
		);

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { date: "now" })
			.expect(200);

		expect(res.body).toMatchObject({ status: "live" });
	});

	it("publishes a draft without visible as visible", async () => {
		const { id } = await createDraft(newsDraft({ content: "Body" }));

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, {})
			.expect(200);

		expect(res.body).toMatchObject({ visible: true });
	});

	it("answers 404 for a draft that doesn't exist", async () => {
		const id = randomUUID();

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(404);

		expect(res.body).toEqual({ error: `ERROR: draft '${id}' not found` });
	});

	// Only the required fields, with every optional one left out and every
	// text that may be blank blank.
	it.each([
		["news", { title: "Title", content: "Body" }],
		["gallery", { collection: "art", caption: "", imageUrl: IMAGE }],
		[
			"downloads",
			{
				collection: "art",
				title: "Pack",
				desc: "",
				downloadUrl: "https://example.com/pack.zip",
				imageUrl: IMAGE
			}
		],
		["maps", { season: 1 }]
	])(
		"publishes a %s draft with only its required fields",
		async (type, fields) => {
			await Promise.all([
				collection("gallery", "collections").insertOne({ slug: "art" }),
				collection("downloads", "collections").insertOne({
					slug: "art"
				})
			]);
			const { id } = await createDraft({ type, fields });

			const res = await editor
				.post(`/editor/drafts/${id}/publish`, { visible: true })
				.expect(200);

			expect(res.body).toMatchObject({ ...fields, revision: 1 });
		}
	);

	it("answers 500 for a stored draft of an unknown type, publishing nothing", async () => {
		const id = randomUUID();
		await stored().insertOne({
			_id: id as never,
			owner: EDITOR.id,
			type: "poll",
			fields: { title: "Draft" },
			revision: 1
		});

		await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(500);

		expect(await stored().findOne()).toMatchObject({ revision: 1 });
		expect(await stored().findOne()).not.toHaveProperty("publishedAs");
	});

	it("returns the same item for an edit draft published twice", async () => {
		const target = { id: await seedPost(), startingRevision: 3 };
		const { id } = await createDraft({
			type: "news",
			fields: { title: "Edited", content: "New" },
			target
		});

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);
		const repeat = await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);

		expect(repeat.body).toEqual(res.body);
		expect(await posts().findOne()).toMatchObject({ revision: 4 });
	});

	// The marker a publish leaves behind, gone as the TTL index deletes it
	// PUBLISHED_DRAFT_TTL_MS later.
	const expire = (id: string) => stored().deleteOne({ _id: id as never });

	it.each([
		["before", false],
		["after", true]
	])(
		"answers 404 to a repeated publish %s its marker expires, once the item was deleted",
		async (_when, expired) => {
			const { id } = await createDraft(newsDraft({ content: "Body" }));
			const published = await editor
				.post(`/editor/drafts/${id}/publish`, { visible: true })
				.expect(200);
			const { id: editId } = await createDraft({
				...newsDraft({ title: "Edited", content: "Body" }),
				target: { id: published.body.id, startingRevision: 1 }
			});
			await editor
				.delete(`/editor/news/${published.body.id}?startingRevision=1`)
				.expect(204);
			if (expired) {
				await expire(id);
			}

			await editor
				.post(`/editor/drafts/${id}/publish`, { visible: true })
				.expect(404);
			await editor
				.post(`/editor/drafts/${editId}/publish`, { visible: true })
				.expect(404);
			expect(await posts().countDocuments()).toBe(0);
		}
	);
});

describe("collection drafts", () => {
	const galleries = () => collection("gallery", "collections");
	const DIMENSION = { name: "Nether", imageUrl: IMAGE };

	function collectionDraft(fields: object = {}) {
		return {
			type: "gallery-collections",
			fields: { slug: "art", title: "Art", ...fields }
		};
	}

	async function seedGallery() {
		await galleries().insertOne({ slug: "art", title: "Art", revision: 2 });
		return { id: "art", startingRevision: 2 };
	}

	it("saves a collection's missing fields, and lists its slug, title, and dimension count", async () => {
		const { id, draft } = await createDraft(
			collectionDraft({ title: undefined, dimensions: [DIMENSION] })
		);
		await createDraft(newsDraft());

		const res = await editor
			.get("/editor/drafts?type=gallery-collections")
			.expect(200);

		expect(draft.fields).toEqual({ slug: "art", dimensions: [DIMENSION] });
		expect(res.body).toEqual([
			{
				id,
				type: "gallery-collections",
				fields: { slug: "art" },
				dimensionCount: 1,
				revision: 1,
				createdAt: expect.any(String),
				updatedAt: expect.any(String)
			}
		]);
	});

	it("answers 404 for an edit draft of a missing collection", async () => {
		const res = await editor
			.put(`/editor/drafts/${randomUUID()}`, {
				...collectionDraft(),
				target: { id: "art", startingRevision: 0 }
			})
			.expect(404);

		expect(res.body.error).toBe(
			"ERROR: gallery collection 'art' not found"
		);
	});

	it("publishes a new collection once, with the draft's visibility", async () => {
		const { id } = await createDraft(
			collectionDraft({ dimensions: [DIMENSION], visible: false })
		);

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, {})
			.expect(200);
		const repeat = await editor
			.post(`/editor/drafts/${id}/publish`, {})
			.expect(200);

		expect(res.body).toMatchObject({
			slug: "art",
			title: "Art",
			dimensions: [DIMENSION],
			visible: false,
			revision: 1,
			itemCount: 0,
			createdBy: EDITOR
		});
		expect(repeat.body).toEqual(res.body);
		expect(await galleries().findOne()).toMatchObject({ createId: id });
		await editor.get(`/editor/drafts/${id}`).expect(404);
	});

	it.each([
		["a missing title", { title: undefined }, "title"],
		[
			"a dimension image outside the allowlist",
			{
				dimensions: [
					{ name: "Nether", imageUrl: "https://example.com/n.png" }
				]
			},
			"dimensions.0.imageUrl: must start with an allowed image host"
		]
	])(
		"checks the draft fully before publishing: %s",
		async (_, fields, error) => {
			const { id } = await createDraft(collectionDraft(fields));

			const res = await editor
				.post(`/editor/drafts/${id}/publish`, {})
				.expect(400);

			expect(res.body.error).toContain(error);
			expect(await galleries().countDocuments()).toBe(0);
		}
	);

	it("answers 409 for a new collection's taken slug", async () => {
		await seedGallery();
		const { id } = await createDraft(collectionDraft());

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, {})
			.expect(409);

		expect(res.body.error).toMatch(/slug already exists/);
	});

	it("updates the collection an edit draft started from, keeping its slug", async () => {
		const target = await seedGallery();
		const { id } = await createDraft({
			...collectionDraft({ slug: "renamed", title: "Edited" }),
			target
		});

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, {})
			.expect(200);

		expect(res.body).toMatchObject({
			slug: "art",
			title: "Edited",
			revision: 3
		});
		expect(await galleries().countDocuments()).toBe(1);
	});

	it("answers 409 with the collection when it changed since the draft started", async () => {
		const target = await seedGallery();
		const { id } = await createDraft({ ...collectionDraft(), target });
		await galleries().updateOne(
			{},
			{ $set: { title: "Theirs", revision: 3 } }
		);

		const res = await editor
			.post(`/editor/drafts/${id}/publish`, {})
			.expect(409);

		expect(res.body.current).toMatchObject({
			slug: "art",
			title: "Theirs"
		});
		await editor.get(`/editor/drafts/${id}`).expect(200);
	});

	it("answers 404 when the collection was deleted, then publishes it as new", async () => {
		const target = await seedGallery();
		const { id } = await createDraft({
			...collectionDraft({ title: "Kept" }),
			target
		});
		await galleries().deleteMany({});

		await editor.post(`/editor/drafts/${id}/publish`, {}).expect(404);
		const res = await editor
			.post(`/editor/drafts/${id}/publish`, { asNew: true })
			.expect(200);

		expect(res.body).toMatchObject({
			slug: "art",
			title: "Kept",
			revision: 1
		});
	});
});

describe("a published draft", () => {
	it("no longer counts towards the cap, nor can be saved, before or after its marker expires", async () => {
		await stored().insertMany(
			Array.from({ length: MAX_DRAFTS_PER_USER - 1 }, () => ({
				_id: randomUUID() as never,
				owner: EDITOR.id,
				type: "news",
				fields: {},
				revision: 1
			}))
		);
		const { id } = await createDraft(newsDraft({ content: "Body" }));
		await editor
			.put(`/editor/drafts/${randomUUID()}`, newsDraft())
			.expect(400);

		await editor
			.post(`/editor/drafts/${id}/publish`, { visible: true })
			.expect(200);
		const save = {
			...newsDraft({ title: "Late", content: "Body" }),
			startingRevision: 1
		};
		await editor.get(`/editor/drafts/${id}`).expect(404);
		await editor.put(`/editor/drafts/${id}`, save).expect(409);
		await stored().deleteOne({ _id: id as never });
		await editor.get(`/editor/drafts/${id}`).expect(404);
		await editor.put(`/editor/drafts/${id}`, save).expect(404);

		await editor
			.put(`/editor/drafts/${randomUUID()}`, newsDraft())
			.expect(201);
	});
});
