// Zod schemas for the editor's request bodies (the contract's *Request
// types): every create, update, bulk write, and draft publish goes through
// them. Each content type has one object of its fields' types and caps, in
// three variants (e.g. newsPostFields):
// - `full` checks a whole item (creates, publishes), also checking image URLs
//   against the allowlist and news markdown,
// - `patch` checks the fields an update sends, the same way,
// - `draft` checks only types and caps, every field optional: drafts are
//   saved as the editor types and checked fully on publish.
// Messages name the field and the rule, never the value sent. `satisfies`
// keeps each object's output in step with the contract's *Fields type.
import * as z from "zod";
import {
	MAX_COLLECTION_TITLE_LENGTH,
	MAX_DOWNLOAD_DESCRIPTION_LENGTH,
	MAX_DOWNLOAD_TITLE_LENGTH,
	MAX_GALLERY_CAPTION_LENGTH,
	MAX_MAP_DIMENSIONS,
	MAX_MAP_DIMENSION_NAME_LENGTH,
	MAX_MAP_WORLD_FIELD_LENGTH,
	MAX_NEWS_CONTENT_LENGTH,
	MAX_NEWS_TITLE_LENGTH,
	MAX_TAGS_PER_IMAGE,
	MAX_TAG_LENGTH,
	MAX_URL_LENGTH
} from "../config/content-limits.ts";
import type {
	CollectionCreateRequest,
	CollectionUpdateRequest,
	DeleteQuery,
	DownloadItemFields,
	GalleryImageFields,
	ImageUploadForm,
	MapSeasonFields,
	NewsPostFields
} from "../contract/api-requests.ts";
import {
	inlineMarkdownProblem,
	isAllowedImageUrl,
	markdownProblem
} from "./markdown.ts";
import { collectionSlug, normaliseTags, queryFor } from "./query-schemas.ts";

function text(max: number) {
	return z.string().trim().max(max, `must be at most ${max} characters`);
}

function requiredText(max: number) {
	return text(max).min(1, "is required");
}

const url = z
	.string()
	.max(MAX_URL_LENGTH, `must be at most ${MAX_URL_LENGTH} characters`);

const webUrl = url.regex(/^https?:\/\//i, "must be an http(s) URL");

const tooManyTags = { error: `at most ${MAX_TAGS_PER_IMAGE} tags` };

// Capped before normalising too, so a huge list is refused unread.
export const tagList = z
	.array(
		text(MAX_TAG_LENGTH).regex(
			/^[a-z0-9 ]*$/i,
			"may contain only letters, digits, and spaces"
		)
	)
	.max(MAX_TAGS_PER_IMAGE, tooManyTags)
	.transform(normaliseTags)
	.pipe(z.array(z.string()).max(MAX_TAGS_PER_IMAGE, tooManyTags));

const mapDimension = z.object({
	name: requiredText(MAX_MAP_DIMENSION_NAME_LENGTH),
	imageUrl: url,
	worldId: requiredText(MAX_MAP_WORLD_FIELD_LENGTH),
	perspective: text(MAX_MAP_WORLD_FIELD_LENGTH)
});

const newsShape = z.object({
	title: requiredText(MAX_NEWS_TITLE_LENGTH),
	content: requiredText(MAX_NEWS_CONTENT_LENGTH),
	imageUrl: url.nullable().optional()
}) satisfies z.ZodType<NewsPostFields>;

const galleryShape = z.object({
	collection: collectionSlug,
	caption: text(MAX_GALLERY_CAPTION_LENGTH),
	imageUrl: url,
	tags: tagList.optional()
}) satisfies z.ZodType<GalleryImageFields>;

const downloadShape = z.object({
	collection: collectionSlug,
	title: requiredText(MAX_DOWNLOAD_TITLE_LENGTH),
	desc: text(MAX_DOWNLOAD_DESCRIPTION_LENGTH),
	downloadUrl: webUrl,
	imageUrl: url,
	sortOrder: z.number().int().nullable().optional()
}) satisfies z.ZodType<DownloadItemFields>;

const mapSeasonShape = z.object({
	season: z.number().int().min(0),
	imageUrl: url.nullable().optional(),
	dimensions: z
		.array(mapDimension)
		.max(MAX_MAP_DIMENSIONS, `at most ${MAX_MAP_DIMENSIONS} dimensions`)
}) satisfies z.ZodType<MapSeasonFields>;

// Reports a problem with one field (by path), unless the field is absent. An
// empty string is checked: it's no allowed image URL.
function check(
	ctx: z.core.$RefinementCtx,
	path: (string | number)[],
	value: string | null | undefined,
	problemOf: (value: string) => string | undefined
): void {
	const problem =
		value === null || value === undefined ? undefined : problemOf(value);
	if (problem) {
		ctx.addIssue({ code: "custom", path, message: problem });
	}
}

function imageUrlProblem(value: string): string | undefined {
	return isAllowedImageUrl(value)
		? undefined
		: "must start with an allowed image host";
}

// The checks beyond types and caps, for whichever fields are present.
type ContentCheck<T> = (fields: Partial<T>, ctx: z.core.$RefinementCtx) => void;

const checkImageUrl: ContentCheck<{ imageUrl: string | null }> = (
	{ imageUrl },
	ctx
) => {
	check(ctx, ["imageUrl"], imageUrl, imageUrlProblem);
};

const checkNews: ContentCheck<NewsPostFields> = (fields, ctx) => {
	check(ctx, ["title"], fields.title, inlineMarkdownProblem);
	check(ctx, ["content"], fields.content, markdownProblem);
	checkImageUrl(fields, ctx);
};

const checkMapSeason: ContentCheck<MapSeasonFields> = (fields, ctx) => {
	checkImageUrl(fields, ctx);
	fields.dimensions?.forEach((dimension, index) => {
		check(
			ctx,
			["dimensions", index, "imageUrl"],
			dimension.imageUrl,
			imageUrlProblem
		);
	});
};

// The three variants of one content type's fields. `partial` is
// `shape.partial()`, made where the shape's type is known: Zod can't infer a
// generic object's partial.
function variants<Shape extends z.ZodObject, PartialShape extends z.ZodObject>(
	shape: Shape,
	partial: PartialShape,
	checkContent: ContentCheck<z.output<Shape>>
) {
	return {
		full: shape.superRefine(checkContent),
		patch: partial.superRefine((fields, ctx) =>
			checkContent(fields as Partial<z.output<Shape>>, ctx)
		),
		draft: partial
	};
}

export const newsPostFields = variants(
	newsShape,
	newsShape.partial(),
	checkNews
);
export const galleryImageFields = variants(
	galleryShape,
	galleryShape.partial(),
	checkImageUrl
);
export const downloadItemFields = variants(
	downloadShape,
	downloadShape.partial(),
	checkImageUrl
);
export const mapSeasonFields = variants(
	mapSeasonShape,
	mapSeasonShape.partial(),
	checkMapSeason
);

export type NewsPostInput = z.infer<typeof newsShape>;
export type GalleryImageInput = z.infer<typeof galleryShape>;
export type DownloadItemInput = z.infer<typeof downloadShape>;
export type MapSeasonInput = z.infer<typeof mapSeasonShape>;

// The revision an update or delete started from (a stored item missing one is
// at 0).
export const startingRevision = z.number().int().min(0);

export const visibility = z.object({ visible: z.boolean().optional() });

export const createId = z.uuid("must be a UUID");

// News `date`: "now" or an ISO date-time. Whether a date is allowed (future,
// or on an update the post's current one) depends on the stored post, so
// resolveNewsDate (src/helpers/news-dates.ts) checks that once it's read.
export const newsDate = z.union([
	z.literal("now"),
	z.iso.datetime({ offset: true, error: 'must be "now" or an ISO date-time' })
]);

export const collectionTitle = requiredText(MAX_COLLECTION_TITLE_LENGTH);

export const collectionCreateRequest = z.toZod<CollectionCreateRequest>()(
	z.object({
		slug: collectionSlug,
		title: collectionTitle,
		visible: z.boolean().optional()
	})
);

export const collectionUpdateRequest = z.toZod<CollectionUpdateRequest>()(
	z.object({
		startingRevision,
		title: collectionTitle.optional(),
		visible: z.boolean().optional()
	})
);

// What a create sends besides the item's fields.
export const createOptions = z.object({
	createId,
	visible: z.boolean().optional()
});

// What an update sends besides the fields it changes.
export const updateOptions = z.object({
	startingRevision,
	visible: z.boolean().optional()
});

// News creates and updates may also send `date`.
export const newsDateOption = z.object({ date: newsDate.optional() });

// A delete's `?startingRevision=`: the revision the editor started from.
export const startingRevisionQuery = queryFor<DeleteQuery>()({
	startingRevision: z
		.string({ error: "startingRevision is required" })
		.regex(/^\d+$/, "startingRevision must be a whole number")
		.transform(Number)
});

// An image upload's form fields: the album, which names the images.
export const imageUploadFields = z.toZod<ImageUploadForm>()(
	z.discriminatedUnion("album", [
		z.object({ album: z.literal("gallery"), collection: collectionSlug }),
		z.object({ album: z.enum(["news", "downloads", "maps"]) })
	])
);

export type ImageUploadFields = z.infer<typeof imageUploadFields>;
