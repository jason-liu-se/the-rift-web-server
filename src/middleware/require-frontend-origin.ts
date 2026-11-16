import type { RequestHandler } from "express";
import { ForbiddenError } from "../errors/forbidden-error.ts";
import { isSafeMethod } from "./http-methods.ts";

// CSRF protection: a request that changes something must come from the
// website. Browsers always send Origin on such requests, and another page
// can't fake it. SameSite=Lax cookies already stay off cross-site requests,
// but not off ones from a sibling subdomain of the same site. A missing Origin
// is refused too: only the website's browser code sends these requests (its
// server rendering only reads).
export function requireFrontendOrigin(frontendOrigin: string): RequestHandler {
	return (req, _res, next) => {
		if (
			!isSafeMethod(req.method) &&
			req.headers.origin !== frontendOrigin
		) {
			throw new ForbiddenError("request must come from the website");
		}
		next();
	};
}
