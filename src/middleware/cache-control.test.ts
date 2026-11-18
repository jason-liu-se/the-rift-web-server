import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PUBLIC_ROUTES } from "../api/public-routes.ts";
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

// Every public read but /health and /auth, with a URL that answers 200.
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
		collection("gallery", "season5").insertOne({ caption: "c", url: "u" }),
		collection("downloads", "season5").insertOne({
			title: "t",
			desc: "d",
			downloadUrl: "u",
			backgroundUrl: "b"
		})
	]);
}

describe("Cache-Control", () => {
	it("covers every public read but /health and /auth", () => {
		const publicReads = PUBLIC_ROUTES.filter(
			({ method, path }) =>
				method === "get" &&
				path !== "/health" &&
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

	it.each([
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
