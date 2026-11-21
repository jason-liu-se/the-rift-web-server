// Zod schemas for the routes' inputs: path and query parameters, and cookies.
// Routes call `.parse(req.params)` / `.parse(req.query)`; the app's error
// handler turns a failed parse into a 400 response.
import * as z from "zod";
import {
	MAX_COLLECTION_SLUG_LENGTH,
	MAX_SEARCH_QUERY_LENGTH,
	MAX_TAGS_PER_IMAGE
} from "../config/content-limits.ts";
import { MAX_EDITOR_PAGE_SIZE } from "../config/requests.ts";

// A gallery or download collection's slug: kebab-case, as in the website's
// URLs.
export const COLLECTION_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const collectionSlug = z
	.string({ error: "a collection slug is required" })
	.max(
		MAX_COLLECTION_SLUG_LENGTH,
		`collection name must be at most ${MAX_COLLECTION_SLUG_LENGTH} characters`
	)
	.regex(COLLECTION_SLUG, "invalid collection name");

// For routes shaped like `/:collection`.
export const collectionParams = z.object({ collection: collectionSlug });

// A gallery's `?tags=a,b`: images with every tag. Must be written one way
// (lowercase, trimmed, unique, and sorted), so variants of one filter can't
// fill Cloudflare's cache with copies.
export const galleryTagsQuery = z.object({
	tags: z
		.string()
		.optional()
		.transform((tags) => (tags ? tags.split(",") : []))
		.refine((tags) => tags.length <= MAX_TAGS_PER_IMAGE, {
			error: `at most ${MAX_TAGS_PER_IMAGE} tags`,
			abort: true
		})
		.refine(
			(tags) => tags.join(",") === normaliseTags(tags).join(","),
			"tags must be lowercase, trimmed, unique, sorted, and comma-separated"
		)
});

// Lowercase, trimmed, unique, and sorted, without empty tags.
export function normaliseTags(tags: readonly string[]): string[] {
	const normalised = tags.map((tag) => tag.trim().toLowerCase());
	return [...new Set(normalised.filter((tag) => tag !== ""))].toSorted();
}

export const paginationQuery = z.object({
	startIndex: z.coerce.number().int().min(0).default(0),
	// Omitted returns every item from `startIndex` onwards.
	limit: z.coerce.number().int().min(1).optional()
});

// For routes shaped like `/:id`: a MongoDB ObjectId.
export const idParams = z.object({
	id: z.string().regex(/^[0-9a-f]{24}$/, "invalid id")
});

// A comma-separated list of names from `allowed`; absent is empty.
function nameList<const Name extends string>(allowed: readonly Name[]) {
	return z
		.string()
		.optional()
		.transform((list) => (list ? list.split(",") : []))
		.pipe(z.array(z.enum(allowed)));
}

// An editor list's filters and search, for one content type: its statuses,
// its searchable fields, and whether it has collections.
export function editorListQuery<
	const Status extends string,
	const Field extends string
>(statuses: readonly Status[], searchFields: readonly Field[]) {
	return paginationQuery.extend({
		// Capped, as editors see every item, hidden ones too.
		limit: z.coerce
			.number()
			.int()
			.min(1)
			.max(MAX_EDITOR_PAGE_SIZE)
			.default(MAX_EDITOR_PAGE_SIZE),
		mine: z.stringbool().optional(),
		status: z.enum(statuses).optional(),
		collection: collectionSlug.optional(),
		q: z
			.string()
			.max(
				MAX_SEARCH_QUERY_LENGTH,
				`q must be at most ${MAX_SEARCH_QUERY_LENGTH} characters`
			)
			.optional(),
		in: nameList(searchFields)
	});
}

// A public read's `v`, the content version the caller last saw (see
// cacheByContentVersion). Kept as the digits sent and compared as text, so
// `01…` or `1e12` can't add cache entries for the version a client normally
// writes.
const V_ERROR = "must be a whole number, the version from GET /content/version";
export const contentVersionQuery = z.object({
	v: z.string({ error: V_ERROR }).regex(/^\d+$/, V_ERROR).optional()
});

// A public read's `dv`, the detail version of its area (DETAIL_VERSION_AREAS)
// the caller last saw: a whole number, compared as sent.
const DV_ERROR =
	"must be a whole number, the version from GET /content/version/:area";
export const detailVersionQuery = z.object({
	dv: z.string({ error: DV_ERROR }).regex(/^\d+$/, DV_ERROR).optional()
});

// `GET /content/version/:area`.
export const detailVersionParams = z.object({ area: z.string() });

// A cookie's value, or undefined when it's absent or not a plain non-empty
// string (cookie-parser turns `j:`-prefixed values into objects). Never fails:
// a bad cookie just counts as missing.
export const cookieValue = z.string().min(1).optional().catch(undefined);

// Discord's redirect back from a login. Discord adds `error` (e.g.
// access_denied) instead of `code` when the user cancels or the request was
// invalid. Parsed with safeParse: the callback redirects instead of answering
// 400.
export const discordCallbackQuery = z.object({
	code: z.string().min(1).optional(),
	state: z.string().min(1).optional(),
	error: z.string().optional()
});
