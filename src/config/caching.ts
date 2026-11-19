// How long public reads may be cached, in seconds (applied by cacheFor).
// Browsers keep a response for `browserSeconds`, Cloudflare's edge for
// `edgeSeconds`. A browser counts the edge copy's age against
// `browserSeconds`, so once that copy is older it revalidates each time
// (cheap: a 304 from the edge, by ETag).
export interface CachePolicy {
	readonly browserSeconds: number;
	readonly edgeSeconds: number;
}

// A read sending the current content version (`?v=`) is cached under it. An
// edit changes the version, and so the URL, so this content never goes stale.
// The edge day still bounds how long an edit made in MongoDB without updating
// the version takes to show.
export const VERSIONED_CACHE: CachePolicy = {
	browserSeconds: 300,
	edgeSeconds: 24 * 60 * 60
};

// The policies below are for reads without `v`, until the website always
// sends it. The edge may also serve these stale for `edgeSeconds` while it
// fetches a fresh copy, so an edit can take up to twice `edgeSeconds`, plus
// `browserSeconds`, to show, unless Cloudflare's cache is purged.
/** News changes most often, so it's cached briefly. */
export const NEWS_CACHE: CachePolicy = { browserSeconds: 60, edgeSeconds: 300 };

/** Gallery, downloads, and maps rarely change. */
export const STATIC_CONTENT_CACHE: CachePolicy = {
	browserSeconds: 300,
	edgeSeconds: 3600
};
