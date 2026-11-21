import * as mongoManager from "../managers/mongo-manager.ts";

// Areas whose public reads can change without a write (a scheduled news post
// going live on its date), so the content version alone can't key their
// cache. Each has a detail version (`GET /content/version/:area`) that callers
// send as `dv` with `v`, and cacheByContentVersion caches the area's routes
// only when both are current. Adding an area is one entry: its public routes
// (full Express paths, as in PUBLIC_ROUTES) and how to compute its key.
export interface DetailVersionArea {
	readonly routes: readonly string[];
	readonly currentKey: () => Promise<string>;
}

export const DETAIL_VERSION_AREAS: Readonly<Record<string, DetailVersionArea>> =
	{
		news: {
			routes: ["/news", "/news/count"],
			currentKey: () => mongoManager.getNewsDetailVersion()
		}
	};

export function detailVersionArea(name: string): DetailVersionArea | undefined {
	return Object.hasOwn(DETAIL_VERSION_AREAS, name)
		? DETAIL_VERSION_AREAS[name]
		: undefined;
}

// The area a route belongs to, if any.
export function detailVersionAreaOf(
	routePath: string
): DetailVersionArea | undefined {
	return Object.values(DETAIL_VERSION_AREAS).find(({ routes }) =>
		routes.includes(routePath)
	);
}
