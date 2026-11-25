// Parses the drafts routes' params, queries, and bodies (/editor/drafts).
// A save's fields are checked only for types and limits (the `draft`
// variants); publishing checks them fully (src/helpers/draft-actions.ts).
import * as z from "zod";
import type { DraftListQuery } from "../contract/api-requests.ts";
import {
	COLLECTION_DRAFT_TYPE_NAMES,
	DRAFT_TYPE_NAMES
} from "../types/editor-content.ts";
import { collectionSlug, idParams, queryFor } from "./query-schemas.ts";
import {
	collectionDraftFields,
	downloadItemFields,
	galleryImageFields,
	mapSeasonFields,
	newsDate,
	newsPostFields,
	startingRevision
} from "./write-schemas.ts";

const draftType = z.enum(DRAFT_TYPE_NAMES);

export const collectionDraftType = z.enum(COLLECTION_DRAFT_TYPE_NAMES);

export const draftParams = z.object({ id: z.uuid("invalid id") });

export const draftsQuery = queryFor<DraftListQuery>()({
	type: draftType.optional()
});

const saveOptions = {
	startingRevision: startingRevision.optional(),
	target: idParams.extend({ startingRevision }).optional()
};

// A collection's edit draft names its target by slug.
const collectionSaveOptions = {
	...saveOptions,
	target: z.object({ id: collectionSlug, startingRevision }).optional()
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
	}),
	z.object({
		type: collectionDraftType,
		fields: collectionDraftFields,
		...collectionSaveOptions
	})
]);

export type DraftSaveRequest = z.infer<typeof draftSaveRequest>;

export const draftPublishRequest = z.object({
	visible: z.boolean().optional(),
	date: newsDate.optional(),
	asNew: z.boolean().optional()
});

export type DraftPublishRequest = z.infer<typeof draftPublishRequest>;
