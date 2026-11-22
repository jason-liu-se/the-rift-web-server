// The response bodies this API sends: the contract with The Rift website.
//
// Edit the contract here, never in the website: the website keeps a verbatim
// copy at ../website/src/app/interfaces/api-responses.ts (refresh it with
// `npm run api:sync` there). Keep this file dependency-free so the copy
// compiles on its own.
//
// Every route sends its body through a schema in
// src/api/response-schemas.ts, which z.toZod checks against these types, so
// the server can't send a different shape.
//
//   GET /content/version         ContentVersion, never cached
//   GET /content/version/:area   DetailVersion, never cached (404 for an
//                                area other than `news`)
//   GET /news                    PaginatedResponse<NewsPost>, newest first
//   GET /news/count              CountResponse
//   GET /gallery                 GalleryCollection[], sorted by slug
//   GET /gallery/:collection     PaginatedResponse<GalleryImage>, newest
//                                first; `tags=a,b` keeps images with every
//                                tag (lowercase, unique, sorted, else 400)
//   GET /gallery/:collection/count  CountResponse; takes `tags` too
//   GET /gallery/:collection/tags   GalleryTags
//   GET /downloads               DownloadCollection[], sorted by slug
//   GET /downloads/:collection   DownloadItem[], by sortOrder, then the
//                                items without one by title
//   GET /maps/seasons            MapSeason[], oldest season first
//   GET /auth/me                 SessionUser (401 when nobody is logged in,
//                                including when the access token expired)
//   POST /auth/refresh           204, no body, with new session cookies (401
//                                when the refresh token is missing, already
//                                used (which ends its session), or its
//                                session is over: log in again)
//   POST /auth/logout            204, no body
//   GET /auth/discord            302 to Discord; Discord's callback then
//                                redirects to the website's /admin, or to
//                                /admin/login?error=LoginErrorCode
//   any error (400, 401, 404, 500)  ErrorResponse; 409 is ConflictResponse
//
// Public reads return only public content: visible, in a visible collection
// (a hidden or missing one is 404), and for news, dated now or earlier.
//
// Every GET above from /news to /maps/seasons takes an optional `v`, the
// current ContentVersion's `version`: with it, responses are cached under that
// version, so send it on every public read to see edits on the next page load.
// /news and /news/count also take `dv`, the current DetailVersion of `news`:
// they're cached only when both `v` and `dv` are current, so a scheduled post
// shows once its date comes. A `dv` that isn't digits is 400.

export interface NewsPost {
	id: string;
	title: string;
	/** ISO 8601 date-time, e.g. 2025-01-01T00:00:00.000Z */
	date: string;
	content: string;
	imageUrl?: string;
	/** ISO 8601; when the title or content last changed after it went live. */
	editedAt?: string;
}

export interface GalleryImage {
	id: string;
	imageUrl: string;
	caption: string;
	/** Lowercase and unique. */
	tags: string[];
}

/** A gallery, e.g. `{ slug: "season5", title: "Season 5" }`. */
export interface GalleryCollection {
	/** In URLs (`/gallery/:collection`); kebab-case, never changes. */
	slug: string;
	title: string;
}

/** The tags on a gallery's public images, sorted. */
export type GalleryTags = string[];

export interface DownloadItem {
	id: string;
	title: string;
	desc: string;
	downloadUrl: string;
	imageUrl: string;
}

export interface DownloadCollection {
	/** The collection's slug, in URLs (`/downloads/:collection`). */
	name: string;
	title: string;
	items: DownloadItem[];
}

/** One world of a season's map, e.g. the overworld. */
export interface MapDimension {
	name: string;
	imageUrl: string;
	/** BlueMap map ID, the URL fragment that opens this dimension */
	worldId: string;
	/** BlueMap perspective (camera position) to open the map at */
	perspective: string;
}

export interface MapSeason {
	id: string;
	/** Season number */
	season: number;
	imageUrl: string;
	dimensions: MapDimension[];
}

/** Changes on every edit to the site's content. */
export interface ContentVersion {
	version: number;
}

/**
 * Changes when an area's public content changes without a write (a scheduled
 * news post going live), e.g. `"1767225600000-3"`. Compare it as a string.
 */
export interface DetailVersion {
	version: string;
}

export interface CountResponse {
	/** Size of the whole collection, not just the returned page. */
	total: number;
}

export interface PaginatedResponse<T> extends CountResponse {
	items: T[];
}

/** A logged-in editor, identified by their Discord account. */
export interface SessionUser {
	/** Discord user ID */
	id: string;
	username: string;
	avatarUrl?: string;
}

/**
 * Why a login failed, sent as `/admin/login?error=<code>`.
 * - `access-denied`: the user cancelled on Discord
 * - `invalid-request`: rejected by the server: a missing, expired, or
 *   mismatched login attempt (try again)
 * - `not-authorized`: rejected by the server: no access grant matches the user
 * - `rate-limited`: rejected by the server: too many requests from this
 *   address (try again in a minute)
 * - `discord-unavailable`: Discord's API failed
 * - `server-error`: this server failed
 */
export type LoginErrorCode =
	| "access-denied"
	| "invalid-request"
	| "not-authorized"
	| "rate-limited"
	| "discord-unavailable"
	| "server-error";

export interface ErrorResponse {
	error: string;
}

/**
 * A 409: the item changed since the editor read it (`current` is how it is
 * now), or a slug or season is already taken (no `current`).
 */
export interface ConflictResponse<T> extends ErrorResponse {
	current?: T;
}

// Request bodies the editor tools send (see the /editor routes). Every write
// is checked against the limits in the server's src/config/content-limits.ts,
// image URLs against its src/config/images.ts allowlist, and news markdown
// for raw HTML and unsafe links or images. A 400 names each wrong field and
// why.

/**
 * When a news post goes live: `"now"` (the server's time), or an ISO 8601
 * date-time in the future (scheduled). An update may also send the post's
 * current date (unchanged); any other past date is 400.
 */
export type NewsDate = "now" | string;

/** A news post's own fields. `title` is inline markdown, `content` markdown. */
export interface NewsPostFields {
	title: string;
	content: string;
	/** null removes it (updates). */
	imageUrl?: string | null;
}

export interface GalleryImageFields {
	/** The gallery's slug. */
	collection: string;
	caption: string;
	imageUrl: string;
	/** Lowercased, trimmed, and deduplicated by the server. */
	tags?: string[];
}

export interface DownloadItemFields {
	/** The download collection's slug. */
	collection: string;
	title: string;
	desc: string;
	downloadUrl: string;
	imageUrl: string;
	/** Ascending; items without one come last, by title. null removes it. */
	sortOrder?: number | null;
}

export interface MapSeasonFields {
	season: number;
	imageUrl: string;
	dimensions: MapDimension[];
}

/** Publishing options every create and update may set. */
export interface VisibilityFields {
	/** Hidden items are only in the editor tools. Creates default to true. */
	visible?: boolean;
}

/**
 * A create. `createId` is a UUID the client makes per new item (a draft's ID
 * doubles as it): repeating the create returns the item already made.
 */
export type CreateRequest<Fields> = Fields &
	VisibilityFields & { createId: string };

/**
 * An update: any of the fields, plus `startRevision`, the item's revision when
 * the editor started (a stale one is a 409).
 */
export type UpdateRequest<Fields> = Partial<Fields> &
	VisibilityFields & { startRevision: number };

export type NewsPostCreateRequest = CreateRequest<NewsPostFields> & {
	/** Absent: now. */
	date?: NewsDate;
};

export type NewsPostUpdateRequest = UpdateRequest<NewsPostFields> & {
	/** Absent: unchanged. */
	date?: NewsDate;
};

/** A gallery or download collection. */
export interface CollectionCreateRequest extends VisibilityFields {
	/** Kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`); fixed once created. */
	slug: string;
	title: string;
}

export interface CollectionUpdateRequest extends VisibilityFields {
	/** The collection's revision when the editor started. */
	startRevision: number;
	title?: string;
}

// What the editor tools read (GET /editor/*, logged in): every item, public
// or not, with its edit history. Sent `Cache-Control: private, no-cache` with
// an ETag, so the browser revalidates (304 when unchanged).
//
//   GET /editor/news                PaginatedResponse<EditorNewsPostSummary>
//   GET /editor/news/:id            EditorNewsPost
//   GET /editor/gallery/collections EditorCollection[], by slug
//   GET /editor/gallery/images      PaginatedResponse<EditorGalleryImage>
//   GET /editor/gallery/images/:id  EditorGalleryImage
//   GET /editor/downloads/collections  EditorCollection[], by slug
//   GET /editor/downloads/items     PaginatedResponse<EditorDownloadItemSummary>
//   GET /editor/downloads/items/:id EditorDownloadItem
//   GET /editor/maps/seasons        PaginatedResponse<EditorMapSeasonSummary>
//   GET /editor/maps/seasons/:id    EditorMapSeason
//
// Lists carry what a table shows; open an item (`/:id`) for all of it.
// Lists are in the public order and take `startIndex`, `limit` (at most 25,
// the default), and filters: `createdBy` and `lastUpdatedBy` (a Discord user
// ID or username, matched exactly), `status` (a ContentStatus, or for news a
// NewsStatus), `collection` (a slug; gallery and downloads; an unknown one
// matches nothing), and a search, `q` (case-insensitive, at most 100
// characters) in the fields `in` names (comma-separated, default all): news
// `title,content`, gallery `caption,tags`, downloads `title,desc`, maps
// `season,dimensions` (season matches a whole number exactly; dimensions by
// name). `total` counts every match. A missing item is 404.

/** The Discord user behind an edit. */
export interface EditorRef {
	id: string;
	username: string;
}

/**
 * - `live`: anyone can see it
 * - `hidden`: only in the editor tools
 */
export type ContentStatus = "live" | "hidden";

/** News also has `scheduled`: visible, but its date hasn't come. */
export type NewsStatus = ContentStatus | "scheduled";

/**
 * What every item and collection the editor reads has. Old ones lack the
 * audit fields.
 */
export interface EditorAuditFields {
	visible: boolean;
	/** Send it back as an update's or delete's `startRevision`; a stale one is 409. */
	revision: number;
	createdBy?: EditorRef;
	lastUpdatedBy?: EditorRef;
	/** ISO 8601 */
	createdAt?: string;
	/** ISO 8601 */
	updatedAt?: string;
}

/** What every item the editor reads has. */
export interface EditorFields<
	Status extends NewsStatus = ContentStatus
> extends EditorAuditFields {
	/** From the item alone: an item in a hidden collection can be live. */
	status: Status;
}

export type EditorNewsPost = NewsPost & EditorFields<NewsStatus>;

export type EditorGalleryImage = GalleryImage &
	EditorFields & {
		/** The gallery's slug. */
		collection: string;
	};

export type EditorDownloadItem = DownloadItem &
	EditorFields & {
		/** The download collection's slug. */
		collection: string;
		sortOrder?: number;
	};

export type EditorMapSeason = MapSeason & EditorFields;

/** A news post in a list: everything but its content. */
export type EditorNewsPostSummary = Omit<EditorNewsPost, "content">;

/** A download item in a list: everything but its description. */
export type EditorDownloadItemSummary = Omit<EditorDownloadItem, "desc">;

/** A map season in a list: how many dimensions it has, not the dimensions. */
export type EditorMapSeasonSummary = Omit<EditorMapSeason, "dimensions"> & {
	dimensionCount: number;
};

/** A gallery or download collection, public or not. */
export interface EditorCollection extends EditorAuditFields {
	slug: string;
	title: string;
	/** Every item in it, public or not (deleting it deletes them all). */
	itemCount: number;
}
