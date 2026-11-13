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

/**
 * Why a login failed, sent as `/admin/login?error=<code>`.
 * - `access-denied`: the user cancelled on Discord
 * - `invalid-request`: rejected by the server: a missing, expired, or
 *   mismatched login attempt (try again)
 * - `not-authorized`: rejected by the server: no access grant matches the user
 * - `discord-unavailable`: Discord's API failed
 * - `server-error`: this server failed
 */
export type LoginErrorCode =
	| "access-denied"
	| "invalid-request"
	| "not-authorized"
	| "discord-unavailable"
	| "server-error";

export interface ErrorResponse {
	error: string;
}
