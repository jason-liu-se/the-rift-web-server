import type { ErrorRequestHandler } from "express";
import * as z from "zod";
import { ForbiddenError } from "../errors/forbidden-error.ts";
import { NotFoundError } from "../errors/not-found-error.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import { forbidCaching } from "./cache-control.ts";
import { UnsupportedMediaTypeError } from "../errors/unsupported-media-type-error.ts";

// What express.json (body-parser) throws when the caller sent a bad body,
// told apart by `type`; its other errors (e.g. "stream.not.readable") are
// server faults. Its own message can quote the body or internals, so callers
// get ours instead.
const bodyParserError = z.object({
	type: z.enum([
		"entity.parse.failed",
		"entity.too.large",
		"request.aborted",
		"request.size.invalid",
		"charset.unsupported",
		"encoding.unsupported"
	]),
	status: z.number().int()
});

const BODY_ERROR_MESSAGES: Readonly<Record<number, string>> = {
	413: "request body too large",
	415: "unsupported request body encoding"
};

// Express 5 sends errors thrown by any route (including rejected promises)
// here. Zod errors come from routes parsing their path and query parameters,
// so they're the caller's mistake (400), as are bad bodies (400, 413, 415).
// UnauthorizedError means nobody is logged in (401), ForbiddenError means it's
// refused whoever asks (403), and NotFoundError means the resource doesn't
// exist (404). Anything else is logged but not exposed (500).
export const handleError: ErrorRequestHandler = (error, req, res, next) => {
	if (res.headersSent) {
		// Too late to send a JSON error; let Express close the connection.
		next(error);
		return;
	}
	// Overrides a route's public caching: an error mustn't outlive its cause.
	forbidCaching(res);

	if (error instanceof z.ZodError) {
		const problems = error.issues.map(
			(issue) => `${issue.path.join(".")}: ${issue.message}`
		);
		res.status(400).json({
			error: `ERROR: invalid request parameters (${problems.join("; ")})`
		});
		return;
	}

	const bodyError = bodyParserError.safeParse(error);
	if (bodyError.success) {
		const { status } = bodyError.data;
		const message = BODY_ERROR_MESSAGES[status] ?? "malformed request body";
		res.status(status).json({ error: `ERROR: ${message}` });
		return;
	}

	if (error instanceof UnauthorizedError) {
		res.status(401).json({ error: `ERROR: ${error.message}` });
		return;
	}

	if (error instanceof ForbiddenError) {
		res.status(403).json({ error: `ERROR: ${error.message}` });
		return;
	}

	if (error instanceof UnsupportedMediaTypeError) {
		res.status(415).json({ error: `ERROR: ${error.message}` });
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
