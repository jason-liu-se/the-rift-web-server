// Builds the Express app without connecting to MongoDB or listening, so tests
// can drive it with Supertest. index.ts does both to run the real server.
import express, { type ErrorRequestHandler } from "express";
import * as z from "zod";
import { newsRouter } from "./routes/news.ts";
import { downloadsRouter } from "./routes/downloads.ts";
import { galleryRouter } from "./routes/gallery.ts";

export const app = express();

app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
	res.header("Access-Control-Allow-Headers", "Content-Type");
	if (req.method === "OPTIONS") {
		res.sendStatus(204);
	} else {
		next();
	}
});
app.use("/news", newsRouter);
app.use("/downloads", downloadsRouter);
app.use("/gallery", galleryRouter);

// Express 5 sends errors thrown by any route (including rejected promises)
// here. Zod errors come from routes parsing their query parameters, so they're
// the caller's mistake (400). Anything else is logged but not exposed (500).
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
		res.status(400).send({
			error: `ERROR: invalid query parameters (${problems.join("; ")})`
		});
		return;
	}

	console.error(`ERROR: ${req.method} ${req.originalUrl} failed:`, error);
	res.status(500).send({
		error: "ERROR: an unexpected server error occurred"
	});
};
app.use(handleError);
