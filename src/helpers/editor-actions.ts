// What the editor routes do around editor-content's queries: who's writing,
// the checks a write needs beyond its body's schema, and turning a write's
// outcome into the response body or the error the handler answers with.
import type { Response } from "express";
import { BadRequestError } from "../errors/bad-request-error.ts";
import { ConflictError } from "../errors/conflict-error.ts";
import { NotFoundError } from "../errors/not-found-error.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import { parseCreate } from "../api/editor-requests.ts";
import {
	EDITOR_ITEM_SCHEMAS,
	editorCollection,
	parseResponse
} from "../api/response-schemas.ts";
import {
	CONTENT_TYPES,
	type CollectionTypeName,
	type CollectionWriteResult,
	type ContentTypeName,
	type CreateResult,
	type FieldChanges,
	type WriteResult,
	createItem,
	hasCollection
} from "../managers/editor-content.ts";

// What each type's item is called in messages.
const ITEM_NAMES: Readonly<Record<ContentTypeName, string>> = {
	news: "news post",
	gallery: "gallery image",
	downloads: "download item",
	maps: "map season"
};

// Who's writing, as stored on the item (never the avatar).
export function editorOf(res: Response): EditorRef {
	const { id, username } = res.locals.user ?? {};
	if (id === undefined || username === undefined) {
		throw new Error("editor route reached without a logged-in user");
	}
	return { id, username };
}

export function itemNotFound(typeName: ContentTypeName, id: string) {
	return new NotFoundError(`${ITEM_NAMES[typeName]} '${id}'`);
}

// An item may only name a collection that exists (public or not).
export async function checkCollection(
	typeName: ContentTypeName,
	fields: FieldChanges
): Promise<void> {
	const { collection } = fields;
	if (
		CONTENT_TYPES[typeName].collectionModel &&
		typeof collection === "string" &&
		!(await hasCollection(typeName, collection))
	) {
		throw new BadRequestError("collection: no such collection");
	}
}

// Checks a create body fully, then creates its item.
export async function createFromBody(
	typeName: ContentTypeName,
	body: unknown,
	editor: EditorRef
): Promise<CreateResult> {
	const { createId, fields } = parseCreate(typeName, body, new Date());
	await checkCollection(typeName, fields);
	return createItem(typeName, createId, fields, editor);
}

// The item a successful write returns, or the error for any other outcome.
export function writtenItem(
	typeName: ContentTypeName,
	id: string,
	result: WriteResult | CreateResult
): unknown {
	const schema = EDITOR_ITEM_SCHEMAS[typeName];
	const itemName = ITEM_NAMES[typeName];
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
