import express, { type Router } from "express";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import type { PublicRoute } from "../routes/public-routes.ts";

// Default deny: every request needs a logged-in editor (res.locals.user, set
// by sessionMiddleware) unless it matches one of publicRoutes. Unknown paths
// need a login too, so logged-out callers can't map the private routes.
export function requireLogin(publicRoutes: readonly PublicRoute[]): Router {
	const router = express.Router();

	// A public route skips the rest of this router.
	for (const { method, path } of publicRoutes) {
		router[method](path, (_req, _res, next) => {
			next("router");
		});
	}

	router.use((_req, res, next) => {
		if (!res.locals.user) {
			throw new UnauthorizedError();
		}
		// What a logged-in editor sees is theirs alone: never cache it.
		res.set("Cache-Control", "no-store");
		next();
	});

	return router;
}
