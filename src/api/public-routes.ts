// The only routes anyone may call. Every other route, including any added
// later, needs a logged-in editor (requireLogin in src/middleware/), so a route
// is private unless it's listed here. Paths are Express patterns, matched as
// the routers match them; a "get" route also covers HEAD.
export interface PublicRoute {
	readonly method: "get" | "post";
	readonly path: string;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
	{ method: "get", path: "/health" },
	{ method: "get", path: "/news" },
	{ method: "get", path: "/news/count" },
	{ method: "get", path: "/gallery/:collection" },
	{ method: "get", path: "/gallery/:collection/count" },
	{ method: "get", path: "/downloads" },
	{ method: "get", path: "/downloads/:collection" },
	// Logging in, and the session's own upkeep, can't require a login.
	{ method: "get", path: "/auth/discord" },
	{ method: "get", path: "/auth/discord/callback" },
	// Answers 401 itself, so the website can tell whether anyone is logged in.
	{ method: "get", path: "/auth/me" },
	{ method: "post", path: "/auth/refresh" },
	{ method: "post", path: "/auth/logout" }
];
