// The response bodies this API sends: the contract with The Rift website,
// with src/contract/api-requests.ts (what each endpoint takes).
//
// Edit the contract here, never in the website: the website keeps a verbatim
// copy of both files in ../website/src/app/interfaces/ (refresh them with
// `npm run api:sync` there). Import only from api-requests.ts, so the copies
// compile on their own.
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
//                                first, with every tag in `tags`
//   GET /gallery/:collection/count  CountResponse
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
// Every GET above from /news to /maps/seasons takes `v` (and news `dv`), so
// it's cached under the current content version: see VersionQuery in
// api-requests.ts.

import type {
	DownloadItemFields,
	DraftContent,
	DraftTarget,
	GalleryImageFields,
	MapSeasonFields,
	NewsPostFields
} from "./api-requests.ts";

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
	imageUrl?: string;
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

// What the editor tools read (GET /editor/*, logged in): every item, public
// or not, with its edit history. Sent `Cache-Control: private, no-cache` with
// an ETag, so the browser revalidates (304 when unchanged).
//
//   GET /editor/news                PaginatedResponse<EditorNewsPostSummary>
//   GET /editor/news/:id            EditorNewsPost
//   GET /editor/gallery/collections EditorCollection[], by slug
//   GET /editor/gallery/images      PaginatedResponse<EditorGalleryImage>
//   GET /editor/gallery/images/:id  EditorGalleryImage
//   GET /editor/gallery/tags        EditorGalleryTags
//   GET /editor/downloads/collections  EditorCollection[], by slug
//   GET /editor/downloads/items     PaginatedResponse<EditorDownloadItemSummary>
//   GET /editor/downloads/items/:id EditorDownloadItem
//   GET /editor/maps/seasons        PaginatedResponse<EditorMapSeasonSummary>
//   GET /editor/maps/seasons/:id    EditorMapSeason
//
// Lists carry what a table shows; open an item (`/:id`) for all of it.
// Lists take an EditorListQuery (api-requests.ts). A missing item is 404.

/**
 * The tags on every gallery image, public or not, and on the editor's own
 * gallery drafts, sorted. Never cached (it holds the caller's drafts').
 */
export type EditorGalleryTags = string[];

/** The Discord user behind an edit, as they were when they made it. */
export interface EditorRef {
	id: string;
	username: string;
	/** Stops loading once they change their avatar: show a fallback. */
	avatarUrl?: string;
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
	/** Send it back as an update's or delete's `startingRevision`; a stale one is 409. */
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

// Bulk actions at /editor/<items>/bulk (e.g. /editor/gallery/images/bulk):
// POST creates (gallery only), PATCH updates, and DELETE deletes, each with
// its request in api-requests.ts of at most the server's MAX_BULK_ITEMS
// (src/config/requests.ts) items. Each answers 200 with
// one BulkResponse, once every item has been processed: never streamed or
// split, so the website reports every failure together. Each item is checked
// and written on its own (no transaction), so some may succeed while others
// fail. An action the type doesn't have (see its *BulkUpdateRequest) is 400,
// as is `move` to a missing collection.

/**
 * One item's outcome, in the order sent. `ok` has the item as written (none
 * for a delete); `conflict` has it as it is now (the revision was stale);
 * `invalid` says what's wrong with that item.
 */
export type BulkItemResult<T> =
	| { id: string; outcome: "ok"; item?: T }
	| { id: string; outcome: "conflict"; current: T }
	| { id: string; outcome: "not-found" }
	| { id: string; outcome: "invalid"; reason: string };

export interface BulkResponse<T> {
	results: BulkItemResult<T>[];
}

// Drafts: an editor's unpublished work, saved as they type, private to them
// (anyone else's draft is 404). Never cached.
//
//   GET    /editor/drafts             DraftSummary[], most recently saved
//                                     first
//   GET    /editor/drafts/:id         Draft
//   PUT    /editor/drafts/:id         DraftSaveRequest → Draft (201 created,
//                                     200 saved, or 200 with the draft as it
//                                     is for a repeated create, which saves
//                                     nothing); 409 ConflictResponse<Draft>
//                                     when another device saved since, or
//                                     when an edit draft of that item exists;
//                                     404 for a save of a draft that's gone
//   DELETE /editor/drafts/:id         204
//   POST   /editor/drafts/:id/publish DraftPublishRequest → the published
//                                     Editor* item; repeating it returns the
//                                     same item. 409 ConflictResponse with the
//                                     item as it is now when it changed since
//                                     the draft started; 404 when it was
//                                     deleted (publish with asNew, or discard)
//
// Drafts are checked only for types and limits; publishing checks them fully
// (400 names each problem). An editor may keep 100 drafts of up to 64 KB of
// fields each.

export type Draft = DraftContent & {
	/** The client's UUID; doubles as the published item's createId. */
	id: string;
	/** The draft's own revision; send it as the next save's `startingRevision`. */
	revision: number;
	/** Absent for a new item. */
	target?: DraftTarget;
	/** ISO 8601 */
	createdAt: string;
	/** ISO 8601 */
	updatedAt: string;
};

/** A draft in the list: what names it so far, without the rest of its fields. */
export type DraftSummary = (
	| {
			type: "news";
			fields: Pick<Partial<NewsPostFields>, "title" | "imageUrl">;
	  }
	| {
			type: "gallery";
			fields: Pick<
				Partial<GalleryImageFields>,
				"caption" | "imageUrl" | "tags"
			>;
	  }
	| {
			type: "downloads";
			fields: Pick<Partial<DownloadItemFields>, "title" | "imageUrl">;
	  }
	| {
			type: "maps";
			fields: Pick<Partial<MapSeasonFields>, "season" | "imageUrl">;
			/** How many dimensions it has so far, not the dimensions. */
			dimensionCount: number;
	  }
) &
	Omit<Draft, "type" | "fields">;

// Image uploads: POST /editor/images with an ImageUploadForm
// (api-requests.ts). Each file goes to imgbb named for its album (e.g.
// `g-season5-spawn`), so one file can fail while others succeed: 200 with a
// result per file, in order.

export type ImageUploadResult =
	/** `url` is the image's direct link, which the allowlist accepts. */
	{ name: string; url: string } | { name: string; error: string };

export interface ImageUploadResponse {
	results: ImageUploadResult[];
}
