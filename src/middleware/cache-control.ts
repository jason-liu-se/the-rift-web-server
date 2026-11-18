import type { RequestHandler, Response } from "express";
import type { CachePolicy } from "../config/caching.ts";

// Cloudflare reads CDN-Cache-Control ahead of Cache-Control, so the edge can
// keep a response longer than browsers. Not s-maxage: Cloudflare then never
// serves stale, which disables stale-while-revalidate.
const CDN_CACHE_CONTROL = "CDN-Cache-Control";

// Lets browsers and Cloudflare keep a public read's response. Mount it per
// public route, never on a whole router, or it would override requireLogin's
// no-store on private routes. handleError calls forbidCaching, so only
// successes are cached.
export function cacheFor({
	browserSeconds,
	edgeSeconds
}: CachePolicy): RequestHandler {
	const browser = `public, max-age=${browserSeconds}`;
	const edge = `public, max-age=${edgeSeconds}, stale-while-revalidate=${edgeSeconds}`;
	return (_req, res, next) => {
		res.set("Cache-Control", browser).set(CDN_CACHE_CONTROL, edge);
		next();
	};
}

// Undoes cacheFor: neither browsers nor Cloudflare may keep this response.
export function forbidCaching(res: Response): void {
	res.set("Cache-Control", "no-store").removeHeader(CDN_CACHE_CONTROL);
}
