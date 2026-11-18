import type { RequestHandler, Response } from "express";
import type { CachePolicy } from "../config/caching.ts";

// Cloudflare reads CDN-Cache-Control ahead of Cache-Control, so the edge can
// keep a response longer than browsers. Not s-maxage: Cloudflare then never
// serves stale, which disables stale-while-revalidate.
const CDN_CACHE_CONTROL = "CDN-Cache-Control";

// The rate limiters' per-caller headers (budget left, partition key), which
// a shared copy mustn't hand to other callers.
const RATE_LIMIT_HEADERS = ["RateLimit", "RateLimit-Policy"];

// Default deny, mounted first: nothing is cached unless a route says so, so
// private, /auth, preflight, and rate-limited responses all get no-store.
export const noCachingByDefault: RequestHandler = (_req, res, next) => {
	forbidCaching(res);
	next();
};

// Lets browsers and Cloudflare keep a public read's response. Mount it per
// public route, never on a whole router, or private routes under the same
// prefix would be cached too. handleError calls forbidCaching, so only
// successes are cached.
export function cacheFor({
	browserSeconds,
	edgeSeconds
}: CachePolicy): RequestHandler {
	const browser = `public, max-age=${browserSeconds}`;
	const edge = `public, max-age=${edgeSeconds}, stale-while-revalidate=${edgeSeconds}`;
	return (_req, res, next) => {
		res.set("Cache-Control", browser).set(CDN_CACHE_CONTROL, edge);
		for (const header of RATE_LIMIT_HEADERS) {
			res.removeHeader(header);
		}
		next();
	};
}

// Neither browsers nor Cloudflare may keep this response (undoes cacheFor).
export function forbidCaching(res: Response): void {
	res.set("Cache-Control", "no-store").removeHeader(CDN_CACHE_CONTROL);
}
