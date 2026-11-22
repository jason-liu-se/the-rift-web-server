// Parses the drafts routes' params, queries, and bodies (/editor/drafts).
// A save's fields are checked only for types and limits (the `draft`
// variants); publishing checks them fully (src/helpers/draft-actions.ts).
import * as z from "zod";
import type { DraftListQuery } from "../contract/api-requests.ts";
import { CONTENT_TYPE_NAMES } from "../managers/editor-content.ts";
import { idParams, queryFor } from "./query-schemas.ts";
import {
	downloadItemFields,
	galleryImageFields,
	mapSeasonFields,
	newsDate,
	newsPostFields,
	revision
} from "./write-schemas.ts";

export const contentType = z.enum(CONTENT_TYPE_NAMES);

export const draftParams = z.object({ id: z.uuid("invalid id") });

export const draftsQuery = queryFor<DraftListQuery>()({
	type: contentType.optional()
});

const saveOptions = {
	revision: revision.optional(),
	target: idParams.extend({ revision }).optional()
};

export const draftSaveRequest = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("news"),
		fields: newsPostFields.draft,
		...saveOptions
	}),
	z.object({
		type: z.literal("gallery"),
		fields: galleryImageFields.draft,
		...saveOptions
	}),
	z.object({
		type: z.literal("downloads"),
		fields: downloadItemFields.draft,
		...saveOptions
	}),
	z.object({
		type: z.literal("maps"),
		fields: mapSeasonFields.draft,
		...saveOptions
	})
]);

export type DraftSaveRequest = z.infer<typeof draftSaveRequest>;

export const draftPublishRequest = z.object({
	visible: z.boolean(),
	date: newsDate.optional(),
	asNew: z.boolean().optional()
});

export type DraftPublishRequest = z.infer<typeof draftPublishRequest>;
