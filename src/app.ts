// Builds the Express app without connecting to MongoDB or listening, so tests
// can drive it with Supertest. index.ts does both to run the real server.
import express, { type Express, type Router } from "express";
import cookieParser from "cookie-parser";
import type { AppConfig } from "./config/env.ts";
import { NotFoundError } from "./errors/not-found-error.ts";
import { noCachingByDefault } from "./middleware/cache-control.ts";
import { allowFrontendOrigin } from "./middleware/cors.ts";
import { handleError } from "./middleware/error-handler.ts";
import { jsonBody } from "./middleware/json-body.ts";
import { requireFrontendOrigin } from "./middleware/require-frontend-origin.ts";
import {
	authRateLimit,
	readRateLimit,
	writeRateLimit
} from "./middleware/rate-limits.ts";
import { requireLogin } from "./middleware/require-login.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { PUBLIC_ROUTES } from "./api/public-routes.ts";
import { authRouter } from "./routes/auth/auth.ts";
import { contentRouter } from "./routes/content/content.ts";
import { editorCollectionsRouter } from "./routes/editor/collections.ts";
import { editorItemsRouter } from "./routes/editor/items.ts";
import { newsRouter } from "./routes/news/news.ts";
import { downloadsRouter } from "./routes/downloads/downloads.ts";
import { galleryRouter } from "./routes/gallery/gallery.ts";
import { healthRouter } from "./routes/health/health.ts";
import { mapsRouter } from "./routes/maps/maps.ts";

export function createApp(config: AppConfig): Express {
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", config.TRUST_PROXY_HOPS);

	app.use(noCachingByDefault);
	app.use(allowFrontendOrigin(config.FRONTEND_URL));
	app.use(requireFrontendOrigin(config.FRONTEND_URL));
	app.use(cookieParser());
	app.use(sessionMiddleware(config));
	// Every request is a read or a write, and /auth also has its own budget.
	// The limiters run before the gate, so they count logged-out requests too.
	app.use(writeRateLimit(config));
	app.use(readRateLimit(config));
	app.use("/auth", authRateLimit(config));
	app.use(requireLogin(PUBLIC_ROUTES));
	app.use(jsonBody());
	for (const [prefix, router] of Object.entries(apiRouters(config))) {
		app.use(prefix, router);
	}

	// Nothing above matched, so answer with a JSON 404 instead of Express's HTML page.
	app.use((req) => {
		throw new NotFoundError(`${req.method} ${req.path}`);
	});
	app.use(handleError);

	return app;
}

// One router per URL prefix. Exported so tests can list every route: Express
// doesn't keep the path a router is mounted at.
export function apiRouters(config: AppConfig): Record<string, Router> {
	return {
		"/health": healthRouter,
		"/auth": authRouter(config),
		"/content": contentRouter,
		"/news": newsRouter,
		"/downloads": downloadsRouter,
		"/gallery": galleryRouter,
		"/maps": mapsRouter,
		// Each editor router has its own prefix, so tests list every route.
		"/editor/news": editorItemsRouter("news"),
		"/editor/gallery/collections": editorCollectionsRouter("gallery"),
		"/editor/gallery/images": editorItemsRouter("gallery"),
		"/editor/downloads/collections": editorCollectionsRouter("downloads"),
		"/editor/downloads/items": editorItemsRouter("downloads"),
		"/editor/maps/seasons": editorItemsRouter("maps")
	};
}
