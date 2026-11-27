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
import { MAX_SEARCH_QUERY_LENGTH } from "../../config/content-limits.ts";
import { app } from "../../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { markPublished } from "../../managers/drafts.ts";
import { asEditor } from "../../../test/editor.ts";
import { EDITOR } from "../../../test/session.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const OTHER = { id: "456", username: "other" };

let editor: Awaited<ReturnType<typeof asEditor>>;
let other: Awaited<ReturnType<typeof asEditor>>;
beforeEach(async () => {
	[editor, other] = await Promise.all([asEditor(), asEditor(OTHER)]);
});

async function seedImages() {
	await collection("gallery", "images").insertMany([
		{
			collection: "season5",
			caption: "a",
			imageUrl: "1.png",
			tags: ["spawn", "night"]
		},
		{
			collection: "season6",
			caption: "b",
			imageUrl: "2.png",
			tags: ["build", "night"],
			visible: false
		},
		// From before tags.
		{ collection: "season6", caption: "c", imageUrl: "3.png" }
	]);
}

function saveGalleryDraft(as: typeof editor, tags: string[]) {
	return as
		.put(`/editor/drafts/${randomUUID()}`, {
			type: "gallery",
			fields: { tags }
		})
		.expect(201);
}

describe("GET /editor/gallery/tags", () => {
	it("answers 401 when logged out", async () => {
		const res = await request(app).get("/editor/gallery/tags").expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
	});

	it("lists every image's tags, hidden ones too, and the caller's gallery drafts', once each, sorted", async () => {
		await seedImages();
		await saveGalleryDraft(editor, ["castle", "night"]);
		await saveGalleryDraft(other, ["secret"]);

		const res = await editor.get("/editor/gallery/tags").expect(200);

		expect(res.body).toEqual(["build", "castle", "night", "spawn"]);
		expect(res.headers["cache-control"]).toBe("no-store");
	});

	it("leaves out published drafts", async () => {
		const {
			body: { id }
		} = await saveGalleryDraft(editor, ["published"]);
		await markPublished(EDITOR.id, id, 1, "item", new Date());

		const res = await editor.get("/editor/gallery/tags").expect(200);

		expect(res.body).toEqual([]);
	});

	it.each([
		["IGH", ["night"]],
		["s", ["castle", "spawn"]],
		// Matched as text, not a pattern.
		[".", []]
	])("keeps the tags containing q=%s", async (q, tags) => {
		await seedImages();
		await saveGalleryDraft(editor, ["castle"]);

		const res = await editor
			.get(`/editor/gallery/tags?q=${encodeURIComponent(q)}`)
			.expect(200);

		expect(res.body).toEqual(tags);
	});

	it("answers 400 for a q that's too long", async () => {
		const res = await editor
			.get(
				`/editor/gallery/tags?q=${"a".repeat(MAX_SEARCH_QUERY_LENGTH + 1)}`
			)
			.expect(400);

		expect(res.body.error).toMatch(/q/);
	});
});
