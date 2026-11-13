// The response bodies this API sends: the contract with The Rift website.
//
// Edit the contract here, never in the website: the website keeps a verbatim
// copy at ../website/src/app/interfaces/api-responses.ts (refresh it with
// `npm run api:sync` there). Keep this file dependency-free so the copy
// compiles on its own.
//
// Every route sends its body through a schema in
// src/routes/response-schemas.ts, which z.toZod checks against these types, so
// the server can't send a different shape.
//
//   GET /news                    PaginatedResponse<NewsItem>, newest first
//   GET /news/count              CountResponse
//   GET /gallery/:collection     PaginatedResponse<GalleryImage>
//   GET /gallery/:collection/count  CountResponse
//   GET /downloads               DownloadCollection[], sorted by name
//   GET /downloads/:collection   DownloadItem[]
//   GET /auth/me                 SessionUser (401 when nobody is logged in)
//   POST /auth/logout            204, no body
//   any error (400, 401, 404, 500)  ErrorResponse

export interface NewsItem {
	title: string;
	/** ISO 8601 date-time, e.g. 2025-01-01T00:00:00.000Z */
	date: string;
	content: string;
	bannerImg?: string;
}

export interface GalleryImage {
	url: string;
	caption: string;
}

export interface DownloadItem {
	title: string;
	desc: string;
	downloadUrl: string;
	backgroundUrl: string;
}

export interface DownloadCollection {
	name: string;
	items: DownloadItem[];
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

export interface ErrorResponse {
	error: string;
}
