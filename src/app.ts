// Builds the Express app without connecting to MongoDB or listening, so tests
// can drive it with Supertest. index.ts does both to run the real server.
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import type { AppConfig } from "./config/env.ts";
import { NotFoundError } from "./errors/not-found-error.ts";
import { allowFrontendOrigin } from "./middleware/cors.ts";
import { handleError } from "./middleware/error-handler.ts";
import { jsonBody } from "./middleware/json-body.ts";
import { requireFrontendOrigin } from "./middleware/require-frontend-origin.ts";
import { writeRateLimit } from "./middleware/rate-limits.ts";
import { requireLogin } from "./middleware/require-login.ts";
import { sessionMiddleware } from "./middleware/session.ts";
import { PUBLIC_ROUTES } from "./routes/public-routes.ts";
import { authRouter } from "./routes/auth.ts";
import { newsRouter } from "./routes/news.ts";
import { downloadsRouter } from "./routes/downloads.ts";
import { galleryRouter } from "./routes/gallery.ts";
import { healthRouter } from "./routes/health.ts";

export function createApp(config: AppConfig): Express {
	const app = express();
	app.disable("x-powered-by");
	app.set("trust proxy", config.TRUST_PROXY_HOPS);

	app.use(allowFrontendOrigin(config.FRONTEND_URL));
	app.use(requireFrontendOrigin(config.FRONTEND_URL));
	app.use(cookieParser());
	app.use(sessionMiddleware(config));
	app.use(requireLogin(PUBLIC_ROUTES, writeRateLimit()));
	app.use(jsonBody());
	app.use("/health", healthRouter);
	app.use("/auth", authRouter(config));
	app.use("/news", newsRouter);
	app.use("/downloads", downloadsRouter);
	app.use("/gallery", galleryRouter);

	// Nothing above matched, so answer with a JSON 404 instead of Express's HTML page.
	app.use((req) => {
		throw new NotFoundError(`${req.method} ${req.path}`);
	});
	app.use(handleError);

	return app;
}
