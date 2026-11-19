import type { RequestHandler, Response } from "express";
import { VERSIONED_CACHE, type CachePolicy } from "../config/caching.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { contentVersionQuery } from "../api/query-schemas.ts";

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

// Lets browsers and Cloudflare keep a public read's response, under the
// content version the caller sends as `v`:
// - the current version: VERSIONED_CACHE, since an edit changes the URL;
// - any other (a tab opened before an edit, or made up): no-store, so stale or
//   random versions can't fill or skip the edge cache;
// - none: `unversioned`, until the website always sends `v`.
// Mount it on every public read, never on a whole router, or private routes
// under the same prefix would be cached too. The version is read before the
// route reads its content, so a response is never older than the version it's
// cached under. handleError calls forbidCaching, so only successes are cached.
export function cacheFor(unversioned: CachePolicy): RequestHandler {
	// Only unversioned content can go stale, so only it may be served stale.
	const unversionedHeaders = cacheHeaders(unversioned, {
		staleWhileRevalidate: true
	});
	const versionedHeaders = cacheHeaders(VERSIONED_CACHE, {
		staleWhileRevalidate: false
	});

	return async (req, res, next) => {
		const { v } = contentVersionQuery.parse(req.query);

		if (v === undefined) {
			allowCaching(res, unversionedHeaders);
		} else if (v === String(await mongoManager.getContentVersion())) {
			allowCaching(res, versionedHeaders);
		}
		next();
	};
}

interface CacheHeaders {
	readonly browser: string;
	readonly edge: string;
}

function cacheHeaders(
	{ browserSeconds, edgeSeconds }: CachePolicy,
	{ staleWhileRevalidate }: { staleWhileRevalidate: boolean }
): CacheHeaders {
	const stale = staleWhileRevalidate
		? `, stale-while-revalidate=${edgeSeconds}`
		: "";
	return {
		browser: `public, max-age=${browserSeconds}`,
		edge: `public, max-age=${edgeSeconds}${stale}`
	};
}

function allowCaching(res: Response, { browser, edge }: CacheHeaders): void {
	res.set("Cache-Control", browser).set(CDN_CACHE_CONTROL, edge);
	for (const header of RATE_LIMIT_HEADERS) {
		res.removeHeader(header);
	}
}

// Neither browsers nor Cloudflare may keep this response (undoes cacheFor).
export function forbidCaching(res: Response): void {
	res.set("Cache-Control", "no-store").removeHeader(CDN_CACHE_CONTROL);
}
