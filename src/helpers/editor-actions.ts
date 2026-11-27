// What the editor routes do around the managers: their list query, who's
// writing, and turning a write's outcome into a response or an error.
import type { Response } from "express";
import { ConflictError } from "../errors/conflict-error.ts";
import { NotFoundError } from "../errors/not-found-error.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import type { EditorCollection } from "../contract/api-responses.ts";
import {
	EDITOR_SUMMARY_SCHEMAS,
	type EditorItemBody,
	editorCollection,
	parseEditorItem,
	parseResponse
} from "../api/response-schemas.ts";
import {
	editorListQuery,
	galleryImageListQuery,
	withOrderForEachSort
} from "../api/query-schemas.ts";
import { CONTENT_TYPES, statusesOf } from "../managers/editor-content.ts";
import type {
	CollectionTypeName,
	CollectionWriteResult,
	ContentTypeName,
	ItemOutcome
} from "../types/editor-content.ts";

// Every field a type's list sends but `status`, which isn't stored (it's
// worked out from each item once read).
function sortFieldsOf(typeName: ContentTypeName): string[] {
	return Object.keys(EDITOR_SUMMARY_SCHEMAS[typeName].shape).filter(
		(field) => field !== "status"
	);
}

/**
 * A type's list query: its statuses, its search and sort fields, `collection`
 * if it has collections, and the gallery's `tags`.
 */
export function listQueryFor(typeName: ContentTypeName) {
	const { searchFields, collectionModel } = CONTENT_TYPES[typeName];
	const fields = {
		statuses: statusesOf(typeName),
		searchFields: Object.keys(searchFields),
		sortFields: sortFieldsOf(typeName)
	};
	if (typeName === "gallery") {
		return withOrderForEachSort(galleryImageListQuery(fields));
	}
	const schema = editorListQuery(fields);
	return withOrderForEachSort(
		collectionModel ? schema : schema.omit({ collection: true })
	);
}

// Who's writing, as stored on the item.
export function editorOf(res: Response): EditorRef {
	const { id, username, avatarUrl } = res.locals.user ?? {};
	if (id === undefined || username === undefined) {
		throw new Error("editor route reached without a logged-in user");
	}
	return { id, username, ...(avatarUrl && { avatarUrl }) };
}

export function itemNotFound(typeName: ContentTypeName, id: string) {
	return new NotFoundError(`${CONTENT_TYPES[typeName].itemName} '${id}'`);
}

type Written<Outcome> = Extract<Outcome, { outcome: "ok" }>;

export function throwUnlessWritten(
	typeName: ContentTypeName,
	id: string,
	result: ItemOutcome
): asserts result is Written<ItemOutcome> {
	const { itemName } = CONTENT_TYPES[typeName];
	switch (result.outcome) {
		case "ok":
			return;
		case "conflict":
			throw new ConflictError(
				`${itemName} '${id}' changed since you read it`,
				parseEditorItem(typeName, result.current)
			);
		case "not-found":
			throw itemNotFound(typeName, id);
		case "duplicate":
			throw new ConflictError(
				`a ${itemName} with that ${result.field} already exists`
			);
		case "invalid":
			throw result.error;
	}
}

export function writtenItem(
	typeName: ContentTypeName,
	id: string,
	result: ItemOutcome
): EditorItemBody | undefined {
	throwUnlessWritten(typeName, id, result);
	return result.item && parseEditorItem(typeName, result.item);
}

export function throwUnlessCollectionWritten(
	typeName: CollectionTypeName,
	slug: string,
	result: CollectionWriteResult
): asserts result is Written<CollectionWriteResult> {
	switch (result.outcome) {
		case "ok":
			return;
		case "conflict":
			throw new ConflictError(
				`${typeName} collection '${slug}' changed since you read it`,
				parseResponse(editorCollection, result.current)
			);
		case "not-found":
			throw new NotFoundError(`${typeName} collection '${slug}'`);
		case "duplicate":
			throw new ConflictError(
				`a ${typeName} collection with that slug already exists`
			);
	}
}

export function writtenCollection(
	typeName: CollectionTypeName,
	slug: string,
	result: CollectionWriteResult
): EditorCollection | undefined {
	throwUnlessCollectionWritten(typeName, slug, result);
	return (
		result.collection && parseResponse(editorCollection, result.collection)
	);
}
