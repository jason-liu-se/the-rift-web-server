import express, { type Request, type RequestHandler } from "express";
import { JSON_BODY_LIMIT } from "../config/requests.ts";
import { UnsupportedMediaTypeError } from "../errors/unsupported-media-type-error.ts";

// Every request body must be JSON, so routes see only parsed, size-limited
// JSON in req.body. Refusing other types also keeps out the form and text
// bodies a cross-site page can send without a CORS preflight. Malformed or
// oversized bodies are body-parser errors, mapped by the error handler.
export function jsonBody(): RequestHandler[] {
	return [
		(req, _res, next) => {
			if (hasBody(req) && !req.is("application/json")) {
				throw new UnsupportedMediaTypeError(
					"request body must be application/json"
				);
			}
			next();
		},
		express.json({ limit: JSON_BODY_LIMIT })
	];
}

// Browsers send an empty POST (e.g. the website's refresh) as Content-Length: 0
// with no Content-Type, which type-is would count as a body.
function hasBody(req: Request): boolean {
	return (
		req.headers["transfer-encoding"] !== undefined ||
		Number(req.headers["content-length"] ?? 0) > 0
	);
}
