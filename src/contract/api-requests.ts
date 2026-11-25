// What the website sends this API: each endpoint's query parameters and
// request body. The other half of the contract with The Rift website, beside
// src/contract/api-responses.ts (the responses); the website keeps a verbatim
// copy of both in ../website/src/app/interfaces/ (refresh them with
// `npm run api:sync` there). Import only from api-responses.ts, so the copies
// compile on their own.
//
// The query schemas in src/api/query-schemas.ts are built with `queryFor`, so
// each reads exactly its type's parameters. Of the bodies, the *Fields and
// collection schemas in src/api/write-schemas.ts are checked against these
// types, and the bulk ones in src/api/bulk-requests.ts for their actions and
// top-level fields; the rest are kept in step by hand.
//
// Path parameters: `:collection` and `:slug` are a collection's slug
// (kebab-case), `:id` an item's ID (24 hex characters), `:area` a detail
// version's area (only `news`). An endpoint not listed takes nothing.
//
//   GET /content/version/:area      —
//   GET /news                       PaginationQuery & NewsVersionQuery
//   GET /news/count                 NewsVersionQuery
//   GET /gallery                    VersionQuery
//   GET /gallery/:collection        PaginationQuery & GalleryTagsQuery &
//                                   VersionQuery
//   GET /gallery/:collection/count  GalleryTagsQuery & VersionQuery
//   GET /gallery/:collection/tags   VersionQuery
//   GET /downloads                  VersionQuery
//   GET /downloads/:collection      VersionQuery
//   GET /maps/seasons               VersionQuery
//   POST /auth/refresh, /auth/logout  no body; the session cookies
//   GET /auth/discord/callback      Discord's redirect, not the website's
//
// The editor tools, for each content type at /editor/news,
// /editor/gallery/images, /editor/downloads/items, and /editor/maps/seasons
// (`<items>`), with NewsPost* for news, GalleryImage* for the gallery, and so
// on:
//
//   GET    /editor/<items>          EditorListQuery<NewsStatus> for news,
//                                   GalleryImageListQuery for the gallery,
//                                   EditorListQuery for the others
//   GET    /editor/<items>/:id      —
//   POST   /editor/<items>          NewsPostCreateRequest, ...
//   PATCH  /editor/<items>/:id      NewsPostUpdateRequest, ...
//   DELETE /editor/<items>/:id      DeleteQuery
//   POST   /editor/<items>/bulk     GalleryImageBulkCreateRequest (gallery
//                                   only)
//   PATCH  /editor/<items>/bulk     NewsPostBulkUpdateRequest, ...
//   DELETE /editor/<items>/bulk     BulkDeleteRequest
//
// And for the collections, at /editor/gallery/collections and
// /editor/downloads/collections:
//
//   POST   /editor/<collections>        CollectionCreateRequest
//   PATCH  /editor/<collections>/:slug  CollectionUpdateRequest
//   DELETE /editor/<collections>/:slug  DeleteQuery
//
// And the gallery's tags, for its tag filter and suggestions:
//
//   GET    /editor/gallery/tags         EditorTagsQuery
//
// And for drafts (see the Drafts note in api-responses.ts):
//
//   GET    /editor/drafts               DraftListQuery
//   PUT    /editor/drafts/:id           DraftSaveRequest
//   POST   /editor/drafts/:id/publish   DraftPublishRequest
//
// And image uploads:
//
//   POST   /editor/images               ImageUploadForm, multipart/form-data
//
// Every write is checked against the limits in the server's
// src/config/content-limits.ts, image URLs against its src/config/images.ts
// allowlist, and news markdown for raw HTML and unsafe links or images. A 400
// names each wrong parameter or field and why.
import type {
	ContentStatus,
	MapDimension,
	NewsStatus
} from "./api-responses.ts";

// Query parameters: numbers are sent as digits.

/** A page of a list: `limit` items from `startIndex`. */
export interface PaginationQuery {
	/** Absent: 0. */
	startIndex?: number;
	/**
	 * Absent: every item from `startIndex` (public lists), or 25 (editor
	 * lists, which take at most 25).
	 */
	limit?: number;
}

/**
 * Every public read's `v`: the current ContentVersion's `version`. With it,
 * the response is cached under that version, so send it on every public read
 * to see edits on the next page load. Any other number, or none, gets current
 * content, uncached; anything but digits is 400.
 */
export interface VersionQuery {
	v?: number;
}

/**
 * The news reads' `dv`, the current DetailVersion of `news`, sent with `v`:
 * they're cached only when both are current, so a scheduled post shows once
 * its date comes. A `dv` that isn't digits is 400.
 */
export interface DetailVersionQuery {
	dv?: string;
}

export type NewsVersionQuery = VersionQuery & DetailVersionQuery;

/**
 * A gallery's images with every tag, comma-separated, e.g. `"night,spawn"`:
 * lowercase, unique, and sorted (else 400).
 */
export interface GalleryTagsQuery {
	tags?: string;
}

/**
 * An editor list's filters and order. Lists are in the public order unless
 * `sort` names fields; `total` counts every match.
 */
export interface EditorListQuery<
	Status extends NewsStatus = ContentStatus
> extends PaginationQuery {
	/** A Discord user ID or username, matched exactly. */
	createdBy?: string;
	/** A Discord user ID or username, matched exactly. */
	lastUpdatedBy?: string;
	status?: Status;
	/** Gallery and downloads only: a slug (an unknown one matches nothing). */
	collection?: string;
	/** A case-insensitive search (at most 100 characters) of the `in` fields. */
	q?: string;
	/**
	 * The fields `q` searches, comma-separated (absent: all): news
	 * `title,content`, gallery `caption,tags`, downloads `title,desc`, maps
	 * `season,dimensions` (season matches a whole number exactly; dimensions
	 * by name).
	 */
	in?: string;
	/**
	 * The fields to sort by, comma-separated and most significant first: any
	 * of the list's summary fields but `status` (`createdBy` and
	 * `lastUpdatedBy` by username). Text ignores the case of ASCII letters, a
	 * missing value sorts first, and ties are broken by `id`, ascending.
	 */
	sort?: string;
	/**
	 * `asc` or `desc` for each `sort` field, comma-separated and in the same
	 * order (missing ones are `asc`); more than `sort` has fields is 400.
	 */
	order?: string;
}

/** The gallery editor list's filters, plus its images with every tag. */
export type GalleryImageListQuery = EditorListQuery & GalleryTagsQuery;

/** The tags containing `q` (case-insensitive, at most 100 characters). */
export interface EditorTagsQuery {
	q?: string;
}

/** A delete: the item's revision when the editor started (stale is 409). */
export interface DeleteQuery {
	startingRevision: number;
}

// Request bodies.

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
	/** null removes it (updates). */
	imageUrl?: string | null;
	dimensions: MapDimension[];
}

/** Publishing options every create and update may set. */
export interface VisibilityFields {
	/** Hidden items are only in the editor tools. Creates default to true. */
	visible?: boolean;
}

/**
 * A create. `createId` is a UUID the client makes per new item (a draft's ID
 * doubles as it): repeating the create returns the item already made, or
 * 404 (a bulk create's `not-found`) if it was deleted while the repeat ran.
 */
export type CreateRequest<Fields> = Fields &
	VisibilityFields & { createId: string };

/**
 * An update: any of the fields, plus `startingRevision`, the item's revision when
 * the editor started (a stale one is a 409).
 */
export type UpdateRequest<Fields> = Partial<Fields> &
	VisibilityFields & { startingRevision: number };

export type NewsPostCreateRequest = CreateRequest<NewsPostFields> & {
	/** Absent: now. */
	date?: NewsDate;
};

export type NewsPostUpdateRequest = UpdateRequest<NewsPostFields> & {
	/** Absent: unchanged. */
	date?: NewsDate;
};

export type GalleryImageCreateRequest = CreateRequest<GalleryImageFields>;
export type GalleryImageUpdateRequest = UpdateRequest<GalleryImageFields>;

export type DownloadItemCreateRequest = CreateRequest<DownloadItemFields>;
export type DownloadItemUpdateRequest = UpdateRequest<DownloadItemFields>;

export type MapSeasonCreateRequest = CreateRequest<MapSeasonFields>;
export type MapSeasonUpdateRequest = UpdateRequest<MapSeasonFields>;

/** A gallery or download collection. */
export interface CollectionCreateRequest extends VisibilityFields {
	/** Kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`); fixed once created. */
	slug: string;
	title: string;
}

export interface CollectionUpdateRequest extends VisibilityFields {
	/** The collection's revision when the editor started. */
	startingRevision: number;
	title?: string;
}

// Bulk actions: what each answers is BulkResponse, in api-responses.ts.

/** An item a bulk action changes, and its revision when the editor read it. */
export interface BulkItemRef {
	id: string;
	startingRevision: number;
}

/** Deletes every item. */
export interface BulkDeleteRequest {
	items: BulkItemRef[];
}

// What a bulk update does to every item: every type can show and hide, and
// each type has its own actions too (its *BulkUpdateRequest).

export interface BulkVisibilityUpdate {
	action: "show" | "hide";
	items: BulkItemRef[];
}

/** Moves every item to another collection of its type (it must exist). */
export interface BulkMoveUpdate {
	action: "move";
	collection: string;
	items: BulkItemRef[];
}

/** Adds or removes every tag on every image. */
export interface BulkTagsUpdate {
	action: "add-tags" | "remove-tags";
	tags: string[];
	items: BulkItemRef[];
}

export type NewsPostBulkUpdateRequest = BulkVisibilityUpdate;
export type GalleryImageBulkUpdateRequest =
	BulkVisibilityUpdate | BulkMoveUpdate | BulkTagsUpdate;
export type DownloadItemBulkUpdateRequest =
	BulkVisibilityUpdate | BulkMoveUpdate;
export type MapSeasonBulkUpdateRequest = BulkVisibilityUpdate;

/** Creates every image; each result's `id` is its item's createId. */
export interface GalleryImageBulkCreateRequest {
	items: GalleryImageCreateRequest[];
}

// Drafts: the Draft each save answers is in api-responses.ts.

export type EditorContentType = "news" | "gallery" | "downloads" | "maps";

/** The drafts list, of every content type unless `type` names one. */
export interface DraftListQuery {
	type?: EditorContentType;
}

/** Kept with a draft's fields, so a change to only these is saved too. */
export interface DraftOptions {
	/** Whether to publish the item visible; publish's `visible` overrides it. */
	visible?: boolean;
}

/** What a draft holds, by content type. */
export type DraftContent =
	| { type: "news"; fields: Partial<NewsPostFields> & DraftOptions }
	| { type: "gallery"; fields: Partial<GalleryImageFields> & DraftOptions }
	| { type: "downloads"; fields: Partial<DownloadItemFields> & DraftOptions }
	| { type: "maps"; fields: Partial<MapSeasonFields> & DraftOptions };

/** The published item an edit draft started from. */
export interface DraftTarget {
	id: string;
	/** The item's revision when the draft started from it. */
	startingRevision: number;
}

/**
 * Creates the draft (no `startingRevision`; `target` for an edit) or saves it
 * (`startingRevision`: the draft's revision when the save started; `type` must
 * match, `target` is ignored).
 */
export type DraftSaveRequest = DraftContent & {
	startingRevision?: number;
	target?: DraftTarget;
};

export interface DraftPublishRequest {
	/** Overrides the draft's `visible`; with neither, the item is visible. */
	visible?: boolean;
	/** News only. Absent: now for a new post, unchanged for an edit. */
	date?: NewsDate;
	/** Publish an edit draft whose item was deleted as a new item. */
	asNew?: boolean;
}

// Image uploads: POST /editor/images, multipart/form-data with up to 20
// `files` (PNG, JPEG, WebP, or GIF, 10 MB each; 413 when larger) and these
// fields. What it answers is ImageUploadResponse, in api-responses.ts.

/** The album to sort the files into; the gallery's names its collection (slug). */
export type ImageUploadForm =
	| { album: "gallery"; collection: string }
	| { album: "news" | "downloads" | "maps" };
