// Builds the Express app without connecting to MongoDB or listening, so tests
// can drive it with Supertest. index.ts does both to run the real server.
import express, {
	type ErrorRequestHandler,
	type Express,
	type RequestHandler
} from "express";
import cookieParser from "cookie-parser";
import * as z from "zod";
import { sessionMiddleware } from "./auth/session-middleware.ts";
import type { AppConfig } from "./config/env.ts";
import { NotFoundError } from "./errors/not-found-error.ts";
import { UnauthorizedError } from "./errors/unauthorized-error.ts";
import { authRouter } from "./routes/auth.ts";
import { newsRouter } from "./routes/news.ts";
import { downloadsRouter } from "./routes/downloads.ts";
import { galleryRouter } from "./routes/gallery.ts";
import { healthRouter } from "./routes/health.ts";

export function createApp(config: AppConfig): Express {
	const app = express();

	app.use(allowFrontendOrigin(config.FRONTEND_URL));
	app.use(cookieParser());
	app.use(sessionMiddleware(config));
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

// CORS: only the website may call the API from a browser, with its cookies.
// Other origins get no CORS headers, so browsers block their requests.
// Server-to-server calls (e.g. the website's server rendering) send no Origin
// and aren't affected.
function allowFrontendOrigin(frontendOrigin: string): RequestHandler {
	return (req, res, next) => {
		// The answer depends on Origin, so caches mustn't share it between origins.
		res.vary("Origin");
		if (req.headers.origin === frontendOrigin) {
			res.header("Access-Control-Allow-Origin", frontendOrigin);
			res.header("Access-Control-Allow-Credentials", "true");
			res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
			res.header("Access-Control-Allow-Headers", "Content-Type");
		}
		if (req.method === "OPTIONS") {
			res.sendStatus(204);
		} else {
			next();
		}
	};
}

// Express 5 sends errors thrown by any route (including rejected promises)
// here. Zod errors come from routes parsing their path and query parameters, so they're
// the caller's mistake (400); UnauthorizedError means nobody is logged in
// (401); NotFoundError means the resource doesn't exist (404). Anything else is logged but not exposed (500).
const handleError: ErrorRequestHandler = (error, req, res, next) => {
	if (res.headersSent) {
		// Too late to send a JSON error; let Express close the connection.
		next(error);
		return;
	}

	if (error instanceof z.ZodError) {
		const problems = error.issues.map(
			(issue) => `${issue.path.join(".")}: ${issue.message}`
		);
		res.status(400).json({
			error: `ERROR: invalid request parameters (${problems.join("; ")})`
		});
		return;
	}

	if (error instanceof UnauthorizedError) {
		res.status(401).json({ error: `ERROR: ${error.message}` });
		return;
	}

	if (error instanceof NotFoundError) {
		res.status(404).json({ error: `ERROR: ${error.message}` });
		return;
	}

	console.error(`ERROR: ${req.method} ${req.originalUrl} failed:`, error);
	res.status(500).json({
		error: "ERROR: an unexpected server error occurred"
	});
};
