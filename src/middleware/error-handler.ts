import type { ErrorRequestHandler } from "express";
import * as z from "zod";
import { NotFoundError } from "../errors/not-found-error.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";

// Express 5 sends errors thrown by any route (including rejected promises)
// here. Zod errors come from routes parsing their path and query parameters,
// so they're the caller's mistake (400); UnauthorizedError means nobody is
// logged in (401); NotFoundError means the resource doesn't exist (404).
// Anything else is logged but not exposed (500).
export const handleError: ErrorRequestHandler = (error, req, res, next) => {
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
