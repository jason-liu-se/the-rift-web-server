import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from "vitest";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import * as mongoManager from "../../managers/mongo-manager.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { asEditor } from "../../../test/editor.ts";
import { definedRoutes } from "../../../test/routes.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const IMAGE = "https://i.ibb.co/abc/banner.png";
const ID = new Types.ObjectId();
const SLUG = "season5";

let editor: Awaited<ReturnType<typeof asEditor>>;
beforeEach(async () => {
	editor = await asEditor();
});

type Editor = typeof editor;

// What each item router needs: where its items are stored, one stored item,
// and a valid create and update.
const ITEM_ROUTERS = {
	"/editor/news": {
		store: ["news", "posts"],
		stored: { title: "t", content: "c", date: new Date("2026-01-01") },
		create: { title: "t", content: "c" },
		update: { title: "Renamed" }
	},
	"/editor/gallery/images": {
		store: ["gallery", "images"],
		stored: { collection: SLUG, caption: "c", imageUrl: IMAGE },
		create: { collection: SLUG, caption: "c", imageUrl: IMAGE },
		update: { caption: "Renamed" }
	},
	"/editor/downloads/items": {
		store: ["downloads", "items"],
		stored: {
			collection: SLUG,
			title: "t",
			desc: "d",
			downloadUrl: "https://example.com/world.zip",
			imageUrl: IMAGE
		},
		create: {
			collection: SLUG,
			title: "t",
			desc: "d",
			downloadUrl: "https://example.com/world.zip",
			imageUrl: IMAGE
		},
		update: { title: "Renamed" }
	},
	"/editor/maps/seasons": {
		store: ["maps", "seasons"],
		stored: { season: 8, imageUrl: IMAGE, dimensions: [] },
		create: { season: 9, imageUrl: IMAGE, dimensions: [] },
		update: { season: 10 }
	}
} as const;

const COLLECTION_ROUTERS = {
	"/editor/gallery/collections": "gallery",
	"/editor/downloads/collections": "downloads"
} as const;

// Seeds what the write needs, then sends it.
type Write = (editor: Editor) => Promise<unknown>;

// Every editor route that writes, with a write that succeeds. A new write
// route fails the coverage test below until it's added here.
const WRITES: Record<string, Write> = {
	...Object.fromEntries(
		Object.entries(ITEM_ROUTERS).flatMap(([prefix, router]) => {
			const [database, name] = router.store;
			const seed = () =>
				collection(database, name).insertOne({
					_id: ID,
					...router.stored
				});
			return [
				[
					`post ${prefix}`,
					(e: Editor) =>
						e
							.post(prefix, {
								createId: randomUUID(),
								...router.create
							})
							.expect(201)
				],
				[
					`patch ${prefix}/:id`,
					async (e: Editor) => {
						await seed();
						return e
							.patch(`${prefix}/${ID.toHexString()}`, {
								startingRevision: 0,
								...router.update
							})
							.expect(200);
					}
				],
				[
					`delete ${prefix}/:id`,
					async (e: Editor) => {
						await seed();
						return e
							.delete(
								`${prefix}/${ID.toHexString()}?startingRevision=0`
							)
							.expect(204);
					}
				]
			];
		})
	),
	...Object.fromEntries(
		Object.entries(COLLECTION_ROUTERS).flatMap(([prefix, database]) => {
			const seed = () =>
				collection(database, "collections").insertOne({
					slug: "worlds",
					title: "W"
				});
			return [
				[
					`post ${prefix}`,
					(e: Editor) =>
						e
							.post(prefix, { slug: "worlds", title: "W" })
							.expect(201)
				],
				[
					`patch ${prefix}/:slug`,
					async (e: Editor) => {
						await seed();
						return e
							.patch(`${prefix}/worlds`, {
								startingRevision: 0,
								title: "R"
							})
							.expect(200);
					}
				],
				[
					`delete ${prefix}/:slug`,
					async (e: Editor) => {
						await seed();
						return e
							.delete(`${prefix}/worlds?startingRevision=0`)
							.expect(204);
					}
				]
			];
		})
	)
};

const READ_METHODS = new Set(["get", "head", "options"]);

describe("editor writes and the content version", () => {
	it("covers every editor route that writes", () => {
		const writeRoutes = definedRoutes()
			.filter(
				({ method, path }) =>
					path.startsWith("/editor/") && !READ_METHODS.has(method)
			)
			.map(({ method, path }) => `${method} ${path}`);

		expect(Object.keys(WRITES).sort()).toEqual(writeRoutes.sort());
	});

	it.each(Object.entries(WRITES))(
		"%s changes the content version",
		async (_route, write) => {
			await Promise.all([
				collection("gallery", "collections").insertOne({ slug: SLUG }),
				collection("downloads", "collections").insertOne({ slug: SLUG })
			]);
			const before = await mongoManager.getContentVersion();

			await write(editor);

			expect(await mongoManager.getContentVersion()).not.toBe(before);
		}
	);
});
