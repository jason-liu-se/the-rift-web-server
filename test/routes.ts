// The routes the app defines, read from its routers, so tests can check every
// route of a kind is covered.
import type { Router } from "express";
import { apiRouters } from "../src/app.ts";
import { testConfig } from "./app.ts";

export interface DefinedRoute {
	readonly method: string;
	readonly path: string;
}

// Every route the app defines, with its full path.
export function definedRoutes(): DefinedRoute[] {
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
