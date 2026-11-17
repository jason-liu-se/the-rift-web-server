import express, { type RequestHandler } from "express";
import { JSON_BODY_LIMIT } from "../config/requests.ts";
import { UnsupportedMediaTypeError } from "../errors/unsupported-media-type-error.ts";

// Every non-empty request body must be JSON, so routes see only parsed,
// size-limited JSON in req.body. Refusing other types also keeps out the form,
// text, and untyped bodies a cross-site page can send without a CORS
// preflight. Malformed or oversized bodies are body-parser errors, mapped by
// the error handler.
export function jsonBody(): RequestHandler[] {
	return [
		express.json({ limit: JSON_BODY_LIMIT }),
		// Reads any other body, only to tell an empty one (a browser's empty
		// POST has no Content-Type; a chunked one has no length) from a refused
		// one.
		express.raw({ type: () => true, limit: JSON_BODY_LIMIT }),
		(req, _res, next) => {
			if (Buffer.isBuffer(req.body)) {
				if (req.body.length > 0) {
					throw new UnsupportedMediaTypeError(
						"request body must be application/json"
					);
				}
				req.body = undefined;
			}
			next();
		}
	];
}
