// What the editor routes do around the writes: who's writing, and turning
// a write's outcome into the response body or the error the handler answers
// with.
import type { Response } from "express";
import { ConflictError } from "../errors/conflict-error.ts";
import { NotFoundError } from "../errors/not-found-error.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import {
	EDITOR_ITEM_SCHEMAS,
	editorCollection,
	parseResponse
} from "../api/response-schemas.ts";
import { CONTENT_TYPES } from "../managers/editor-content.ts";
import type {
	CollectionTypeName,
	CollectionWriteResult,
	ContentTypeName,
	ItemOutcome
} from "../types/editor-content.ts";

// Who's writing, as stored on the item (never the avatar).
export function editorOf(res: Response): EditorRef {
	const { id, username } = res.locals.user ?? {};
	if (id === undefined || username === undefined) {
		throw new Error("editor route reached without a logged-in user");
	}
	return { id, username };
}

export function itemNotFound(typeName: ContentTypeName, id: string) {
	return new NotFoundError(`${CONTENT_TYPES[typeName].itemName} '${id}'`);
}

// The item a successful write returns, or the error for any other outcome.
export function writtenItem(
	typeName: ContentTypeName,
	id: string,
	result: ItemOutcome
): unknown {
	const schema = EDITOR_ITEM_SCHEMAS[typeName];
	const { itemName } = CONTENT_TYPES[typeName];
	switch (result.outcome) {
		case "ok":
			return result.item && parseResponse(schema, result.item);
		case "conflict":
			throw new ConflictError(
				`${itemName} '${id}' changed since you read it`,
				parseResponse(schema, result.current)
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

// The collection a successful write returns, or the error for any other
// outcome.
export function writtenCollection(
	typeName: CollectionTypeName,
	slug: string,
	result: CollectionWriteResult
): unknown {
	switch (result.outcome) {
		case "ok":
			return (
				result.collection &&
				parseResponse(editorCollection, result.collection)
			);
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
