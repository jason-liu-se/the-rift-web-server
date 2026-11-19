import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PUBLIC_ROUTES } from "../api/public-routes.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { app } from "../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { sessionCookie } from "../../test/session.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

// From src/config/caching.ts: what browsers and what Cloudflare may keep.
const NEWS = {
	"cache-control": "public, max-age=60",
	"cdn-cache-control": "public, max-age=300, stale-while-revalidate=300"
};
const STATIC_CONTENT = {
	"cache-control": "public, max-age=300",
	"cdn-cache-control": "public, max-age=3600, stale-while-revalidate=3600"
};
const VERSIONED = {
	"cache-control": "public, max-age=300",
	"cdn-cache-control": "public, max-age=86400"
};

const VERSION = 1763500000000;

// Public reads that must always reach the server, besides /auth: uptime
// pings, and the version every versioned read depends on.
const NEVER_CACHED = ["/health", "/content/version"];

// Every other public read, with a URL that answers 200.
const CACHEABLE_ROUTES = [
	["/news", "/news", NEWS],
	["/news/count", "/news/count", NEWS],
	["/gallery", "/gallery", STATIC_CONTENT],
	["/gallery/:collection", "/gallery/season5", STATIC_CONTENT],
	["/gallery/:collection/count", "/gallery/season5/count", STATIC_CONTENT],
	["/downloads", "/downloads", STATIC_CONTENT],
	["/downloads/:collection", "/downloads/season5", STATIC_CONTENT],
	["/maps/seasons", "/maps/seasons", STATIC_CONTENT]
] as const;

function seedCollections() {
	return Promise.all([
		collection("content", "meta").insertOne({
			// The raw driver types _id as an ObjectId; MongoDB takes any value.
			_id: "contentVersion" as never,
			version: VERSION
		}),
		collection("gallery", "season5").insertOne({
			caption: "c",
			imageUrl: "i"
		}),
		collection("downloads", "season5").insertOne({
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

	it.each(CACHEABLE_ROUTES)(
		"%s is cacheable, even for a logged-in editor",
		async (_path, url, headers) => {
			await seedCollections();

			const [loggedOut, loggedIn] = await Promise.all([
				request(app).get(url).expect(200),
				request(app)
					.get(url)
					.set("Cookie", await sessionCookie())
					.expect(200)
			]);

			expect(loggedOut.headers).toMatchObject(headers);
			expect(loggedIn.headers).toMatchObject(headers);
			// A shared copy mustn't carry one caller's rate-limit state.
			expect(loggedOut.headers).not.toHaveProperty("ratelimit");
			expect(loggedOut.headers).not.toHaveProperty("ratelimit-policy");
		}
	);

	// Every public read is versioned: cacheFor applies `v`, and the test
	// above fails if a public read doesn't mount cacheFor.
	describe.each(CACHEABLE_ROUTES)("%s with ?v=", (_path, url) => {
		const withVersion = (v: string) =>
			`${url}${url.includes("?") ? "&" : "?"}v=${v}`;

		it("is cached under the current version", async () => {
			await seedCollections();

			const res = await request(app)
				.get(withVersion(String(VERSION)))
				.expect(200);

			expect(res.headers).toMatchObject(VERSIONED);
			expect(res.headers).not.toHaveProperty("ratelimit");
		});

		it.each([
			["an old version", String(VERSION - 1)],
			["the version written differently", `0${VERSION}`]
		])(
			"answers %s with current content, never cached",
			async (_name, v) => {
				await seedCollections();
				const current = await request(app).get(url).expect(200);

				const res = await request(app).get(withVersion(v)).expect(200);

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

	it.each([
		["/content/version", "get", "/content/version"],
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
