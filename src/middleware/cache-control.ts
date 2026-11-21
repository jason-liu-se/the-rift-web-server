import type { Request, RequestHandler, Response } from "express";
import { VERSIONED_CACHE } from "../config/caching.ts";
import { detailVersionAreaOf } from "../config/detail-versions.ts";
import * as mongoManager from "../managers/mongo-manager.ts";
import {
	contentVersionQuery,
	detailVersionQuery
} from "../api/query-schemas.ts";

// Cloudflare reads CDN-Cache-Control ahead of Cache-Control, so the edge can
// keep a response longer than browsers.
const CDN_CACHE_CONTROL = "CDN-Cache-Control";

const BROWSER_POLICY = `public, max-age=${VERSIONED_CACHE.browserSeconds}`;
const EDGE_POLICY = `public, max-age=${VERSIONED_CACHE.edgeSeconds}`;

// The rate limiters' per-caller headers (budget left, partition key), which
// a shared copy mustn't hand to other callers.
const RATE_LIMIT_HEADERS = ["RateLimit", "RateLimit-Policy"];

// Default deny, mounted first: nothing is cached unless a route says so, so
// private, /auth, preflight, and rate-limited responses all get no-store.
export const noCachingByDefault: RequestHandler = (_req, res, next) => {
	forbidCaching(res);
	next();
};

// Lets browsers and Cloudflare keep a public read's response for
// VERSIONED_CACHE, but only when the caller sends the current content version
// as `v`: an edit changes the version, and so the URL, so the copy never goes
// stale. Any other `v` (a tab opened before an edit, or made up), or none, gets
// no-store, so stale, random, or unversioned URLs can't fill or skip the edge
// cache. Mount it on every public read, never on a whole router, or private
// routes under the same prefix would be cached too. The version is read before
// the route reads its content, so a response is never older than the version
// it's cached under. handleError calls forbidCaching, so only successes are
// cached. A route in a detail-version area (src/config/detail-versions.ts)
// also needs that area's current version as `dv`.
export const cacheByContentVersion: RequestHandler = async (req, res, next) => {
	const { v } = contentVersionQuery.parse(req.query);
	const { dv } = detailVersionQuery.parse(req.query);
	const area = detailVersionAreaOf(routePattern(req));

	const [version, detailVersion] = await Promise.all([
		mongoManager.getContentVersion(),
		area?.currentKey()
	]);
	if (v === String(version) && dv === detailVersion) {
		allowCaching(res);
	}
	next();
};

// The route's full Express pattern, e.g. `/gallery/:collection`, as listed in
// PUBLIC_ROUTES.
function routePattern(req: Request): string {
	const path: string = req.route?.path ?? "";
	return path === "/" ? req.baseUrl : `${req.baseUrl}${path}`;
}

function allowCaching(res: Response): void {
	res.set("Cache-Control", BROWSER_POLICY).set(
		CDN_CACHE_CONTROL,
		EDGE_POLICY
	);
	for (const header of RATE_LIMIT_HEADERS) {
		res.removeHeader(header);
	}
}

// Neither browsers nor Cloudflare may keep this response (undoes
// cacheByContentVersion).
export function forbidCaching(res: Response): void {
	res.set("Cache-Control", "no-store").removeHeader(CDN_CACHE_CONTROL);
}
