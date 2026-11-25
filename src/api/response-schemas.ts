// Zod schemas for the response bodies in src/contract/api-responses.ts. Routes
// pass every body through `parseResponse` before sending it, which:
// - drops fields outside the contract (e.g. MongoDB's `_id` and `__v`),
// - turns stored Dates into ISO strings,
// - throws (a 500) when stored data is missing a required field, instead of
//   sending the website a body it can't use.
// z.toZod makes each schema's output type exactly equal its contract type, so
// the two can't drift apart without a compile error.
import * as z from "zod";
import {
	downloadItemFields,
	galleryImageFields,
	mapSeasonFields,
	newsPostFields
} from "./write-schemas.ts";
import type {
	ContentVersion,
	CountResponse,
	DetailVersion,
	DownloadCollection,
	DownloadItem,
	Draft,
	DraftSummary,
	EditorCollection,
	EditorDownloadItem,
	EditorDownloadItemSummary,
	EditorGalleryImage,
	EditorGalleryTags,
	EditorMapSeason,
	EditorMapSeasonSummary,
	EditorNewsPost,
	EditorNewsPostSummary,
	GalleryCollection,
	GalleryImage,
	GalleryTags,
	ImageUploadResponse,
	MapSeason,
	NewsPost,
	PaginatedResponse,
	SessionUser
} from "../contract/api-responses.ts";
import type { ContentTypeName } from "../types/editor-content.ts";

const isoDate = z.date().transform((date) => date.toISOString());

const newsPost = z.toZod<NewsPost>()(
	z.object({
		id: z.string(),
		title: z.string(),
		date: isoDate,
		content: z.string(),
		imageUrl: z.string().optional(),
		editedAt: isoDate.optional()
	})
);

const galleryImage = z.toZod<GalleryImage>()(
	z.object({
		id: z.string(),
		imageUrl: z.string(),
		caption: z.string(),
		// Images stored before tags have none.
		tags: z.array(z.string()).default([])
	})
);

export const galleryCollections = z.toZod<GalleryCollection[]>()(
	z.array(z.object({ slug: z.string(), title: z.string() }))
);

export const galleryTags = z.toZod<GalleryTags>()(z.array(z.string()));

export const editorGalleryTags = z.toZod<EditorGalleryTags>()(
	z.array(z.string())
);

const downloadItem = z.toZod<DownloadItem>()(
	z.object({
		id: z.string(),
		title: z.string(),
		desc: z.string(),
		downloadUrl: z.string(),
		imageUrl: z.string()
	})
);

export const downloadItems = z.toZod<DownloadItem[]>()(z.array(downloadItem));

export const downloadCollections = z.toZod<DownloadCollection[]>()(
	z.array(
		z.object({ name: z.string(), title: z.string(), items: downloadItems })
	)
);

const mapSeason = z.toZod<MapSeason>()(
	z.object({
		id: z.string(),
		season: z.number().int(),
		imageUrl: z.string().optional(),
		dimensions: z.array(
			z.object({
				name: z.string(),
				imageUrl: z.string(),
				worldId: z.string(),
				perspective: z.string()
			})
		)
	})
);

export const mapSeasons = z.toZod<MapSeason[]>()(z.array(mapSeason));

export const contentVersion = z.toZod<ContentVersion>()(
	z.object({ version: z.number().int() })
);

export const detailVersion = z.toZod<DetailVersion>()(
	z.object({ version: z.string() })
);

export const countResponse = z.toZod<CountResponse>()(
	z.object({ total: z.number().int().min(0) })
);

export const newsPostsPage = z.toZod<PaginatedResponse<NewsPost>>()(
	countResponse.extend({ items: z.array(newsPost) })
);

export const galleryPage = z.toZod<PaginatedResponse<GalleryImage>>()(
	countResponse.extend({ items: z.array(galleryImage) })
);

const editorRef = z.object({
	id: z.string(),
	username: z.string(),
	avatarUrl: z.string().optional()
});

// What the editor reads about every item and collection. Ones from before the
// editor tools have no `visible` (visible), `revision` (0), or audit fields.
const editorAuditFields = {
	visible: z.boolean().default(true),
	revision: z.number().int().default(0),
	createdBy: editorRef.optional(),
	lastUpdatedBy: editorRef.optional(),
	createdAt: isoDate.optional(),
	updatedAt: isoDate.optional()
};

// Every item's, but news's: only news can be scheduled (NewsStatus).
const editorFields = {
	...editorAuditFields,
	status: z.enum(["live", "hidden"])
};

export const editorNewsPost = z.toZod<EditorNewsPost>()(
	newsPost.extend({
		...editorAuditFields,
		status: z.enum(["live", "scheduled", "hidden"])
	})
);

export const editorGalleryImage = z.toZod<EditorGalleryImage>()(
	galleryImage.extend({ ...editorFields, collection: z.string() })
);

export const editorDownloadItem = z.toZod<EditorDownloadItem>()(
	downloadItem.extend({
		...editorFields,
		collection: z.string(),
		sortOrder: z.number().optional()
	})
);

export const editorMapSeason = z.toZod<EditorMapSeason>()(
	mapSeason.extend(editorFields)
);

// What the lists send (see the contract's *Summary types).
export const editorNewsPostSummary = z.toZod<EditorNewsPostSummary>()(
	editorNewsPost.omit({ content: true })
);

export const editorDownloadItemSummary = z.toZod<EditorDownloadItemSummary>()(
	editorDownloadItem.omit({ desc: true })
);

export const editorMapSeasonSummary = z.toZod<EditorMapSeasonSummary>()(
	editorMapSeason
		.omit({ dimensions: true })
		.extend({ dimensionCount: z.number().int().min(0) })
);

const EDITOR_ITEM_SCHEMAS = {
	news: editorNewsPost,
	gallery: editorGalleryImage,
	downloads: editorDownloadItem,
	maps: editorMapSeason
} as const satisfies Record<ContentTypeName, z.ZodType>;

/** Any type's editor item, as sent. */
export type EditorItemBody = z.output<
	(typeof EDITOR_ITEM_SCHEMAS)[ContentTypeName]
>;

export function parseEditorItem(
	typeName: ContentTypeName,
	item: unknown
): EditorItemBody {
	return parseResponse<EditorItemBody>(EDITOR_ITEM_SCHEMAS[typeName], item);
}

// What each type's list sends of an item.
export const EDITOR_SUMMARY_SCHEMAS: Readonly<
	Record<ContentTypeName, z.ZodType>
> = {
	news: editorNewsPostSummary,
	gallery: editorGalleryImage,
	downloads: editorDownloadItemSummary,
	maps: editorMapSeasonSummary
};

// A page of any editor item type.
export function editorPage<T>(item: z.ZodType<T>) {
	return countResponse.extend({ items: z.array(item) });
}

export const editorCollection = z.toZod<EditorCollection>()(
	z.object({
		slug: z.string(),
		title: z.string(),
		itemCount: z.number().int().min(0),
		...editorAuditFields
	})
);

export const editorCollections = z.toZod<EditorCollection[]>()(
	z.array(editorCollection)
);

const draftFields = {
	id: z.string(),
	revision: z.number().int(),
	target: z
		.object({ id: z.string(), startingRevision: z.number().int() })
		.optional(),
	createdAt: isoDate,
	updatedAt: isoDate
};

// A stored draft's fields were checked when saved; they're parsed again so
// the response carries only the contract's fields.
export const draft = z.toZod<Draft>()(
	z.discriminatedUnion("type", [
		z.object({
			type: z.literal("news"),
			fields: newsPostFields.draft,
			...draftFields
		}),
		z.object({
			type: z.literal("gallery"),
			fields: galleryImageFields.draft,
			...draftFields
		}),
		z.object({
			type: z.literal("downloads"),
			fields: downloadItemFields.draft,
			...draftFields
		}),
		z.object({
			type: z.literal("maps"),
			fields: mapSeasonFields.draft,
			...draftFields
		})
	])
);

export const draftSummaries = z.toZod<DraftSummary[]>()(
	z.array(
		z.discriminatedUnion("type", [
			z.object({
				type: z.literal("news"),
				fields: newsPostFields.draft.pick({
					title: true,
					imageUrl: true
				}),
				...draftFields
			}),
			z.object({
				type: z.literal("gallery"),
				fields: galleryImageFields.draft.pick({
					caption: true,
					imageUrl: true,
					tags: true
				}),
				...draftFields
			}),
			z.object({
				type: z.literal("downloads"),
				fields: downloadItemFields.draft.pick({
					title: true,
					imageUrl: true
				}),
				...draftFields
			}),
			z.object({
				type: z.literal("maps"),
				fields: mapSeasonFields.draft.pick({
					season: true,
					imageUrl: true
				}),
				dimensionCount: z.number().int().min(0),
				...draftFields
			})
		])
	)
);

export const imageUploadResponse = z.toZod<ImageUploadResponse>()(
	z.object({
		results: z.array(
			z.union([
				z.object({ name: z.string(), url: z.string() }),
				z.object({ name: z.string(), error: z.string() })
			])
		)
	})
);

export const sessionUser = z.toZod<SessionUser>()(
	z.object({
		id: z.string(),
		username: z.string(),
		avatarUrl: z.string().optional()
	})
);

// Throws a plain Error, not a ZodError, so the error handler answers 500 (our
// data is wrong) rather than 400 (the caller's request is wrong).
export function parseResponse<T>(schema: z.ZodType<T>, body: unknown): T {
	const result = schema.safeParse(body);

	if (!result.success) {
		throw new Error(
			`response breaks the API contract:\n${z.prettifyError(result.error)}`
		);
	}
	return result.data;
}
