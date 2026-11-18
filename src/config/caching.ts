// How long public reads may be cached, in seconds. Browsers keep a response
// for `browserSeconds`. Cloudflare's edge, which can be purged, keeps it for
// `edgeSeconds`, then may serve it stale for as long again while it fetches a
// fresh one. Content is edited straight in MongoDB, so an edit can take up to
// twice `edgeSeconds`, plus `browserSeconds`, to show, unless the cache is
// purged.
export interface CachePolicy {
	readonly browserSeconds: number;
	readonly edgeSeconds: number;
}

/** News changes most often, so it's cached briefly. */
export const NEWS_CACHE: CachePolicy = { browserSeconds: 60, edgeSeconds: 300 };

/** Gallery, downloads, and maps rarely change. */
export const STATIC_CONTENT_CACHE: CachePolicy = {
	browserSeconds: 300,
	edgeSeconds: 3600
};
