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
	CountResponse,
	DownloadCollection,
	DownloadItem,
	GalleryImage,
	NewsItem,
	PaginatedResponse,
	SessionUser
} from "../contract/api-responses.ts";

const newsItem = z.toZod<NewsItem>()(
	z.object({
		id: z.string(),
		title: z.string(),
		date: z.date().transform((date) => date.toISOString()),
		content: z.string(),
		bannerImg: z.string().optional()
	})
);

const galleryImage = z.toZod<GalleryImage>()(
	z.object({ id: z.string(), url: z.string(), caption: z.string() })
);

export const downloadItems = z.toZod<DownloadItem[]>()(
	z.array(
		z.object({
			id: z.string(),
			title: z.string(),
			desc: z.string(),
			downloadUrl: z.string(),
			backgroundUrl: z.string()
		})
	)
);

export const downloadCollections = z.toZod<DownloadCollection[]>()(
	z.array(z.object({ name: z.string(), items: downloadItems }))
);

export const countResponse = z.toZod<CountResponse>()(
	z.object({ total: z.number().int().min(0) })
);

export const newsPage = z.toZod<PaginatedResponse<NewsItem>>()(
	countResponse.extend({ items: z.array(newsItem) })
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
