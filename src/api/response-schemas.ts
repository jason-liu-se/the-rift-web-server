// Zod schemas for the response bodies in src/contract/api-responses.ts. Routes
// pass every body through `parseResponse` before sending it, which:
// - drops fields outside the contract (e.g. MongoDB's `_id` and `__v`),
// - turns stored Dates into ISO strings,
// - throws (a 500) when stored data is missing a required field, instead of
//   sending the website a body it can't use.
// z.toZod makes each schema's output type exactly equal its contract type, so
// the two can't drift apart without a compile error.
import * as z from "zod";
import type {
	ContentVersion,
	CountResponse,
	DetailVersion,
	DownloadCollection,
	DownloadItem,
	GalleryCollection,
	GalleryImage,
	GalleryTags,
	MapSeason,
	NewsPost,
	PaginatedResponse,
	SessionUser
} from "../contract/api-responses.ts";

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

export const downloadItems = z.toZod<DownloadItem[]>()(
	z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			desc: z.string(),
			downloadUrl: z.string(),
			imageUrl: z.string()
		})
	)
);

export const downloadCollections = z.toZod<DownloadCollection[]>()(
	z.array(
		z.object({ name: z.string(), title: z.string(), items: downloadItems })
	)
);

export const mapSeasons = z.toZod<MapSeason[]>()(
	z.array(
		z.object({
			id: z.string(),
			season: z.number().int(),
			imageUrl: z.string(),
			dimensions: z.array(
				z.object({
					name: z.string(),
					imageUrl: z.string(),
					worldId: z.string(),
					perspective: z.string()
				})
			)
		})
	)
);

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
