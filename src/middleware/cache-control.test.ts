import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi
} from "vitest";
import request from "supertest";
import { PUBLIC_ROUTES } from "../api/public-routes.ts";
import * as mongoManager from "../managers/mongo-manager.ts";
import { app } from "../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { sessionCookie } from "../../test/session.ts";

beforeAll(startDatabase);
afterEach(async () => {
	vi.useRealTimers();
	await clearDatabase();
});
afterAll(stopDatabase);

// From src/config/caching.ts: what browsers and what Cloudflare may keep.
const VERSIONED = {
	"cache-control": "public, max-age=300",
	"cdn-cache-control": "public, max-age=86400"
};

const VERSION = 1763500000000;

// Public reads that must always reach the server, besides /auth: uptime
// pings, and the version every versioned read depends on.
const NEVER_CACHED = ["/health", "/content/version", "/content/version/:area"];

// The news detail version with no news posts seeded.
const NO_NEWS = "0-0";

// Every other public read, with a URL that answers 200.
const CACHEABLE_ROUTES = [
	["/news", `/news?dv=${NO_NEWS}`],
	["/news/count", `/news/count?dv=${NO_NEWS}`],
	["/gallery", "/gallery"],
	["/gallery/:collection", "/gallery/season5"],
	["/gallery/:collection/count", "/gallery/season5/count"],
	["/gallery/:collection/tags", "/gallery/season5/tags"],
	["/downloads", "/downloads"],
	["/downloads/:collection", "/downloads/season5"],
	["/maps/seasons", "/maps/seasons"]
] as const;

function seedCollections() {
	return Promise.all([
		collection("content", "meta").insertOne({
			// The raw driver types _id as an ObjectId; MongoDB takes any value.
			_id: "contentVersion" as never,
			version: VERSION
		}),
		collection("gallery", "collections").insertOne({
			slug: "season5",
			title: "Season 5"
		}),
		collection("gallery", "images").insertOne({
			collection: "season5",
			caption: "c",
			imageUrl: "i"
		}),
		collection("downloads", "collections").insertOne({
			slug: "season5",
			title: "Season 5"
		}),
		collection("downloads", "items").insertOne({
			collection: "season5",
			title: "t",
			desc: "d",
			downloadUrl: "u",
			imageUrl: "i"
		})
	]);
}

describe("Cache-Control", () => {
	it("covers every public read but the never-cached ones", () => {
		const publicReads = PUBLIC_ROUTES.filter(
			({ method, path }) =>
				method === "get" &&
				!NEVER_CACHED.includes(path) &&
				!path.startsWith("/auth")
		).map(({ path }) => path);

		expect(CACHEABLE_ROUTES.map(([path]) => path)).toEqual(publicReads);
	});

	// The test above fails if a public read doesn't mount
	// cacheByContentVersion, so every public read handles `v`.
	describe.each(CACHEABLE_ROUTES)("%s", (_path, url) => {
		const withVersion = (v: string) =>
			`${url}${url.includes("?") ? "&" : "?"}v=${v}`;

		it("is cached under the current version, even for a logged-in editor", async () => {
			await seedCollections();
			const current = withVersion(String(VERSION));

			const [loggedOut, loggedIn] = await Promise.all([
				request(app).get(current).expect(200),
				request(app)
					.get(current)
					.set("Cookie", await sessionCookie())
					.expect(200)
			]);

			expect(loggedOut.headers).toMatchObject(VERSIONED);
			expect(loggedIn.headers).toMatchObject(VERSIONED);
			// A shared copy mustn't carry one caller's rate-limit state.
			expect(loggedOut.headers).not.toHaveProperty("ratelimit");
			expect(loggedOut.headers).not.toHaveProperty("ratelimit-policy");
		});

		it.each([
			["no version", url],
			["an old version", withVersion(String(VERSION - 1))],
			["the version written differently", withVersion(`0${VERSION}`)]
		])(
			"answers %s with current content, never cached",
			async (_name, uncachedUrl) => {
				await seedCollections();
				const current = await request(app)
					.get(withVersion(String(VERSION)))
					.expect(200);

				const res = await request(app).get(uncachedUrl).expect(200);

				expect(res.body).toEqual(current.body);
				expect(res.headers["cache-control"]).toBe("no-store");
				expect(res.headers).not.toHaveProperty("cdn-cache-control");
			}
		);

		it("stops caching under a version once it changes", async () => {
			await seedCollections();

			const updated = await mongoManager.updateContentVersion();
			const [old, current] = await Promise.all([
				request(app)
					.get(withVersion(String(VERSION)))
					.expect(200),
				request(app)
					.get(withVersion(String(updated)))
					.expect(200)
			]);

			expect(old.headers["cache-control"]).toBe("no-store");
			expect(current.headers).toMatchObject(VERSIONED);
		});

		it("answers 400 when v isn't a version", async () => {
			await seedCollections();

			const res = await request(app).get(withVersion("abc")).expect(400);

			expect(res.body.error).toMatch(/v must be a content version/);
			expect(res.headers["cache-control"]).toBe("no-store");
		});
	});

	describe.each(["/news", "/news/count"])(
		"%s, a detail-version area",
		(url) => {
			const current = `${url}?v=${VERSION}`;

			it.each([
				["no dv", current],
				["an old dv", `${current}&dv=1-0`]
			])(
				"answers %s with current content, never cached",
				async (_name, uncachedUrl) => {
					await seedCollections();

					const res = await request(app).get(uncachedUrl).expect(200);

					expect(res.headers["cache-control"]).toBe("no-store");
				}
			);

			it("stops caching under a dv once a scheduled post goes live", async () => {
				await seedCollections();
				const soon = new Date(Date.now() + 60_000);
				await collection("news", "posts").insertOne({
					title: "t",
					content: "c",
					date: soon
				});
				await request(app)
					.get(`${current}&dv=${NO_NEWS}`)
					.expect(200)
					.expect("cache-control", VERSIONED["cache-control"]);

				// Only Date: MongoDB's driver still needs real timers.
				vi.useFakeTimers({ toFake: ["Date"] });
				vi.setSystemTime(Date.now() + 120_000);

				const [old, live] = await Promise.all([
					request(app).get(`${current}&dv=${NO_NEWS}`).expect(200),
					request(app)
						.get(`${current}&dv=${soon.getTime()}-0`)
						.expect(200)
				]);
				expect(old.headers["cache-control"]).toBe("no-store");
				expect(live.headers).toMatchObject(VERSIONED);
			});

			it.each(["abc", "1", "1-", "-1", "1-2-3"])(
				"answers 400 when dv isn't a detail version (%s)",
				async (dv) => {
					const res = await request(app)
						.get(`${current}&dv=${dv}`)
						.expect(400);

					expect(res.body.error).toMatch(
						/dv must be a detail version/
					);
				}
			);
		}
	);

	it.each([
		["/content/version", "get", "/content/version"],
		["/content/version/news", "get", "/content/version/news"],
		["a missing collection (404)", "get", "/gallery/missing"],
		["bad parameters (400)", "get", "/news?limit=-1"],
		["a private route, logged out (401)", "get", "/news/drafts"],
		["/health", "get", "/health"],
		["/auth/me (401)", "get", "/auth/me"],
		["a preflight", "options", "/news"]
	] as const)("isn't public for %s", async (_name, method, url) => {
		const res = await request(app)[method](url);

		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.headers).not.toHaveProperty("cdn-cache-control");
	});
});
