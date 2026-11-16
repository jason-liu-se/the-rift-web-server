import { describe, expect, it } from "vitest";
import express, { type Express, type Router } from "express";
import request from "supertest";
import { handleError } from "./error-handler.ts";
import { requireLogin } from "./require-login.ts";
import { type PublicRoute, PUBLIC_ROUTES } from "../api/public-routes.ts";
import { apiRouters } from "../app.ts";
import { testConfig } from "../../test/app.ts";

// The gate alone, in front of a route that answers every request, so these
// tests need no database.
function gate(publicRoutes: readonly PublicRoute[]): Express {
	return express()
		.use(requireLogin(publicRoutes))
		.use((_req, res) => {
			res.sendStatus(200);
		})
		.use(handleError);
}

const gated = gate(PUBLIC_ROUTES);

interface DefinedRoute {
	readonly method: string;
	readonly path: string;
}

// Every route the app defines, with its full path.
function definedRoutes(): DefinedRoute[] {
	return Object.entries(apiRouters(testConfig)).flatMap(([prefix, router]) =>
		routesOf(router).map(({ method, path }) => ({
			method,
			path: path === "/" ? prefix : `${prefix}${path}`
		}))
	);
}

function routesOf(router: Router): DefinedRoute[] {
	return router.stack.flatMap(({ route }) => {
		if (!route) {
			return [];
		}
		const methods = new Set(route.stack.map((layer) => layer.method));
		return [...methods].map((method) => ({ method, path: route.path }));
	});
}

function isPublic({ method, path }: DefinedRoute): boolean {
	return PUBLIC_ROUTES.some(
		(route) => route.method === method && route.path === path
	);
}

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

describe("PUBLIC_ROUTES", () => {
	it.each(PUBLIC_ROUTES)("lists $method $path, a defined route", (route) => {
		expect(definedRoutes()).toContainEqual(route);
	});

	// A public pattern also matches other paths: /gallery/:collection would
	// match a private GET /gallery/drafts and let logged-out callers in.
	it("doesn't match any private route", async () => {
		const leaks: string[] = [];
		for (const route of definedRoutes().filter((r) => !isPublic(r))) {
			const res = await request(gated)[route.method as "get"](
				urlFor(route.path)
			);
			if (res.status !== 401) {
				leaks.push(`${route.method} ${route.path}`);
			}
		}

		expect(leaks).toEqual([]);
	});

	it("doesn't make the paths under a public route public", async () => {
		const newsOnly = gate([{ method: "get", path: "/news" }]);

		await request(newsOnly).get("/news").expect(200);
		await request(newsOnly).get("/news/drafts").expect(401);
		await request(newsOnly).get("/news/some-id/drafts").expect(401);
	});
});
