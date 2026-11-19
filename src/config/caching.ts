// How long public reads may be cached, in seconds (applied by
// cacheByContentVersion). Browsers keep a response for `browserSeconds`,
// Cloudflare's edge for `edgeSeconds`. A browser counts the edge copy's age
// against `browserSeconds`, so once that copy is older it revalidates each
// time (cheap: a 304 from the edge, by ETag).
export interface CachePolicy {
	readonly browserSeconds: number;
	readonly edgeSeconds: number;
}

// Only a read sending the current content version (`?v=`) is cached, under
// it. An edit changes the version, and so the URL, so this content never goes
// stale. The edge day still bounds how long an edit made in MongoDB without
// updating the version takes to show.
export const VERSIONED_CACHE: CachePolicy = {
	browserSeconds: 300,
	edgeSeconds: 24 * 60 * 60
};
