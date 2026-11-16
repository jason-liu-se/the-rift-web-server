import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { handleError } from "./error-handler.ts";
import { requireLogin } from "./require-login.ts";
import { PUBLIC_ROUTES } from "../routes/public-routes.ts";

// The gate alone, in front of a route that answers every request, so these
// tests need no database and run over the real PUBLIC_ROUTES.
const gated = express()
	.use(requireLogin(PUBLIC_ROUTES))
	.use((_req, res) => {
		res.sendStatus(200);
	})
	.use(handleError);

// A concrete URL for a route pattern.
function urlFor(path: string): string {
	return path.replaceAll(/:\w+/g, "some-id");
}

describe("requireLogin, logged out", () => {
	it.each(PUBLIC_ROUTES)("lets $method $path through", async (route) => {
		await request(gated)[route.method](urlFor(route.path)).expect(200);
	});

	it.each(PUBLIC_ROUTES.filter((route) => route.method === "get"))(
		"lets HEAD $path through",
		async (route) => {
			await request(gated).head(urlFor(route.path)).expect(200);
		}
	);

	it.each([
		["post", "/news"],
		["put", "/news/some-id"],
		["patch", "/news/some-id"],
		["delete", "/gallery/some-id"],
		["get", "/news/drafts"],
		["get", "/gallery/some-id/some-item"],
		["post", "/health"],
		["delete", "/auth/me"],
		["get", "/auth/refresh"],
		["get", "/does-not-exist"]
	] as const)("answers %s %s with 401", async (method, url) => {
		const res = await request(gated)[method](url).expect(401);

		expect(res.body).toEqual({ error: "ERROR: not logged in" });
	});
});
