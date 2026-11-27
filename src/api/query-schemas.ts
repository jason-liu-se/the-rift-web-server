// Zod schemas for the routes' inputs: path and query parameters, and cookies.
// Routes call `.parse(req.params)` / `.parse(req.query)`; the app's error
// handler turns a failed parse into a 400 response. Each query schema the
// website sends to is built with `queryFor`, so it reads exactly the
// parameters of its type in src/contract/api-requests.ts.
import * as z from "zod";
import {
	MAX_COLLECTION_SLUG_LENGTH,
	MAX_SEARCH_QUERY_LENGTH,
	MAX_TAGS_PER_IMAGE
} from "../config/content-limits.ts";
import { MAX_EDITOR_PAGE_SIZE } from "../config/requests.ts";
import type { NewsStatus } from "../contract/api-responses.ts";
import type { SortOrder } from "../types/editor-content.ts";
import type {
	DetailVersionQuery,
	EditorListQuery,
	EditorTagsQuery,
	GalleryImageListQuery,
	GalleryTagsQuery,
	PaginationQuery,
	VersionQuery
} from "../contract/api-requests.ts";

// A parameter's value as the website sends it: numbers become digits.
type Sent<Value> = Value extends number ? `${number}` : Value;

// Each parameter of `Shape` must be in `Query` and take every value the
// website may send for it (a missing one too, when it's optional), and every
// parameter of `Query` must be in `Shape`. Values arrive as strings, so a
// coerced number's input is typed `string` (z.coerce.number<string>()) for
// the check to mean anything. The mismatch types name what's
// wrong in the compile error.
type QueryShape<Query, Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: K extends keyof Query
		? Sent<Query[K]> extends z.input<Shape[K]>
			? Shape[K]
			: { "doesn't take what the contract sends": Query[K] }
		: { "isn't in the contract": K };
} & {
	[K in Exclude<keyof Query, keyof Shape>]-?: { "is missing": Query[K] };
};

// A query schema for its contract type: `z.object(shape)`, failing to compile
// when the shape and the type name different parameters (`satisfies` would
// miss an extra or renamed one).
export function queryFor<Query>() {
	return <const Shape extends z.ZodRawShape>(
		shape: Shape & QueryShape<Query, Shape>
	) => z.object(shape);
}

// A gallery or download collection's slug: kebab-case, as in the website's
// URLs.
const COLLECTION_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const collectionSlug = z
	.string({ error: "a collection slug is required" })
	.max(
		MAX_COLLECTION_SLUG_LENGTH,
		`collection name must be at most ${MAX_COLLECTION_SLUG_LENGTH} characters`
	)
	.regex(COLLECTION_SLUG, "invalid collection name");

// For routes shaped like `/:slug` (a collection's own routes).
export const slugParams = z.object({ slug: collectionSlug });

// For routes shaped like `/:collection`.
export const collectionParams = z.object({ collection: collectionSlug });

// A gallery's `?tags=a,b`: images with every tag. Must be written one way
// (lowercase, trimmed, unique, and sorted), so variants of one filter can't
// fill Cloudflare's cache with copies.
export const galleryTagsQuery = queryFor<GalleryTagsQuery>()({
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

const paginationShape = {
	startIndex: z.coerce.number<string>().int().min(0).default(0),
	// Omitted returns every item from `startIndex` onwards.
	limit: z.coerce.number<string>().int().min(1).optional()
};
export const paginationQuery = queryFor<PaginationQuery>()(paginationShape);

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

const SORT_ORDERS = ["asc", "desc"] as const satisfies readonly SortOrder[];

// A Discord user in an editor list's filter: their ID or username (at most 32
// characters, Discord's limit).
const editorUser = z.string().min(1).max(32);

// A case-insensitive search's text.
const searchText = z
	.string()
	.max(
		MAX_SEARCH_QUERY_LENGTH,
		`q must be at most ${MAX_SEARCH_QUERY_LENGTH} characters`
	)
	.optional();

/** What an editor list can filter, search, and sort by, per content type. */
export interface EditorListFields {
	readonly statuses: readonly NewsStatus[];
	readonly searchFields: readonly string[];
	readonly sortFields: readonly string[];
}

// An editor list's filters, search, and order, for one content type.
function editorListShape({
	statuses,
	searchFields,
	sortFields
}: EditorListFields) {
	return {
		...paginationShape,
		// Capped, as editors see every item, hidden ones too.
		limit: z.coerce
			.number<string>()
			.int()
			.min(1)
			.max(MAX_EDITOR_PAGE_SIZE)
			.default(MAX_EDITOR_PAGE_SIZE),
		createdBy: editorUser.optional(),
		lastUpdatedBy: editorUser.optional(),
		status: z.enum(statuses).optional(),
		collection: collectionSlug.optional(),
		q: searchText,
		in: nameList(searchFields),
		sort: nameList(sortFields).refine(
			(fields) => new Set(fields).size === fields.length,
			"sort must not name a field twice"
		),
		order: nameList(SORT_ORDERS)
	};
}

export function editorListQuery(fields: EditorListFields) {
	return queryFor<EditorListQuery<NewsStatus>>()(editorListShape(fields));
}

// The gallery's editor list, which also filters by tags like the public one.
export function galleryImageListQuery(fields: EditorListFields) {
	return queryFor<GalleryImageListQuery>()({
		...editorListShape(fields),
		...galleryTagsQuery.shape
	});
}

// An editor list's `order` pairs with its `sort` by position, so it can't be
// longer. Checked last, once a type's schema is complete (it may omit fields).
export function withOrderForEachSort<
	Schema extends z.ZodType<{
		readonly sort: readonly string[];
		readonly order: readonly SortOrder[];
	}>
>(schema: Schema) {
	return schema.refine(({ sort, order }) => order.length <= sort.length, {
		error: "order must not have more entries than sort",
		path: ["order"]
	});
}

// `GET /editor/gallery/tags`.
export const editorTagsQuery = queryFor<EditorTagsQuery>()({ q: searchText });

// A public read's `v`, the content version the caller last saw (see
// cacheByContentVersion). Kept as the digits sent and compared as text, so
// `01…` or `1e12` can't add cache entries for the version a client normally
// writes.
const V_ERROR = "must be a whole number, the version from GET /content/version";
export const contentVersionQuery = queryFor<VersionQuery>()({
	v: z.string({ error: V_ERROR }).regex(/^\d+$/, V_ERROR).optional()
});

// A public read's `dv`, the detail version of its area (DETAIL_VERSION_AREAS)
// the caller last saw: a whole number, compared as sent.
const DV_ERROR =
	"must be a whole number, the version from GET /content/version/:area";
export const detailVersionQuery = queryFor<DetailVersionQuery>()({
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
