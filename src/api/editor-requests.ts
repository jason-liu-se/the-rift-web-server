// Parses the editor's list queries, and its create and update bodies for any
// content type into what's stored: the type's fields (src/api/write-schemas.ts) plus the
// options every write takes, with news dates resolved by
// src/helpers/news-dates.ts. Shared by single and bulk writes.
import * as z from "zod";
import {
	CONTENT_TYPES,
	type ContentTypeName,
	statusesOf,
	type FieldChanges,
	type StoredItem
} from "../managers/editor-content.ts";
import { newsCreateFields, newsUpdateFields } from "../helpers/news-dates.ts";
import { editorListQuery } from "./query-schemas.ts";
import {
	createOptions,
	downloadItemFields,
	galleryImageFields,
	mapSeasonFields,
	newsDateOption,
	newsPostFields,
	updateOptions
} from "./write-schemas.ts";

export const FIELD_SCHEMAS = {
	news: newsPostFields,
	gallery: galleryImageFields,
	downloads: downloadItemFields,
	maps: mapSeasonFields
} as const;

// What a create body stores, beyond createId and the audit fields.
export function parseCreate(
	typeName: ContentTypeName,
	body: unknown,
	now: Date
): { createId: string; fields: FieldChanges } {
	const fields = FIELD_SCHEMAS[typeName].full;
	if (typeName !== "news") {
		const { createId, ...parsed } = z
			.intersection(createOptions, fields)
			.parse(body);
		return { createId, fields: parsed };
	}
	const { createId, date, ...parsed } = z
		.intersection(z.intersection(createOptions, newsDateOption), fields)
		.parse(body);
	return {
		createId,
		fields: { ...parsed, ...newsCreateFields({ ...parsed, date }, now) }
	};
}

// What an update body changes, given the stored item.
export function parseUpdate(
	typeName: ContentTypeName,
	body: unknown,
	now: Date
): {
	startingRevision: number;
	fields: FieldChanges;
	changesFor: (current: StoredItem) => FieldChanges;
} {
	const fields = FIELD_SCHEMAS[typeName].patch;
	if (typeName !== "news") {
		const { startingRevision, ...parsed } = z
			.intersection(updateOptions, fields)
			.parse(body);
		return { startingRevision, fields: parsed, changesFor: () => parsed };
	}
	const { startingRevision, date, ...parsed } = z
		.intersection(z.intersection(updateOptions, newsDateOption), fields)
		.parse(body);
	return {
		startingRevision,
		fields: parsed,
		changesFor: (current) => ({
			...parsed,
			...newsUpdateFields(current, { ...parsed, date }, now)
		})
	};
}

// A type's list query: its statuses and search fields, and `collection` only
// for the types with collections.
export function listQueryFor(typeName: ContentTypeName) {
	const { searchFields, collectionModel } = CONTENT_TYPES[typeName];
	const schema = editorListQuery(
		statusesOf(typeName),
		Object.keys(searchFields)
	);
	return collectionModel ? schema : schema.omit({ collection: true });
}
