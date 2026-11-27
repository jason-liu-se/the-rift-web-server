// The bulk actions (/editor/<items>/bulk), written through editor-writes.
import * as z from "zod";
import { BadRequestError } from "../errors/bad-request-error.ts";
import * as collectionsManager from "../managers/editor-collections.ts";
import type {
	ContentTypeName,
	FieldChanges,
	ItemOutcome,
	StoredItem
} from "../types/editor-content.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import type { BulkItemResult } from "../contract/api-responses.ts";
import { MAX_TAGS_PER_IMAGE } from "../config/content-limits.ts";
import {
	BULK_CREATE_REQUESTS,
	BULK_UPDATE_REQUESTS,
	type BulkUpdateRequest,
	bulkDeleteRequest
} from "../api/bulk-requests.ts";
import { parseUpdate } from "../api/editor-requests.ts";
import { normaliseTags } from "../api/query-schemas.ts";
import {
	type EditorItemBody,
	parseEditorItem
} from "../api/response-schemas.ts";
import {
	createEach,
	deleteEach,
	itemRef,
	updateEach
} from "./editor-writes.ts";

function problemsOf(error: unknown): string {
	return error instanceof z.ZodError
		? error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ")
		: error instanceof Error
			? error.message
			: String(error);
}

// An item's bulk result, sending its item through the type's response schema.
function itemProcessingResult(
	typeName: ContentTypeName,
	id: string,
	outcome: ItemOutcome
): BulkItemResult<EditorItemBody> {
	switch (outcome.outcome) {
		case "ok":
			return {
				id,
				outcome: "ok",
				...(outcome.item && {
					item: parseEditorItem(typeName, outcome.item)
				})
			};
		case "conflict":
			return {
				id,
				outcome: "conflict",
				current: parseEditorItem(typeName, outcome.current)
			};
		case "not-found":
			return { id, outcome: "not-found" };
		case "duplicate":
			return {
				id,
				outcome: "invalid",
				reason: `${outcome.field}: already taken`
			};
		case "invalid":
			return {
				id,
				outcome: "invalid",
				reason: problemsOf(outcome.error)
			};
	}
}

// The changes a bulk update's action makes to one stored item.
function changesFromAction(
	typeName: ContentTypeName,
	request: BulkUpdateRequest,
	startingRevision: number,
	now: Date
): (current: StoredItem) => FieldChanges {
	switch (request.action) {
		case "show":
		case "hide":
			return parseUpdate(
				typeName,
				{ startingRevision, visible: request.action === "show" },
				now
			).changesFor;
		case "move":
			return () => ({ collection: request.collection });
		case "add-tags":
		case "remove-tags": {
			const { action, tags } = request;
			return (current) => {
				const stored = Array.isArray(current["tags"])
					? current["tags"].map(String)
					: [];
				const updatedTags = normaliseTags(
					action === "add-tags"
						? [...stored, ...tags]
						: stored.filter((tag) => !tags.includes(tag))
				);
				if (updatedTags.length > MAX_TAGS_PER_IMAGE) {
					throw new BadRequestError(
						`tags: at most ${MAX_TAGS_PER_IMAGE} tags`
					);
				}
				return { tags: updatedTags };
			};
		}
	}
}

export interface BulkOutcome {
	readonly results: BulkItemResult<EditorItemBody>[];
	/** Whether any item was written, so the content version must change. */
	readonly wrote: boolean;
}

function bulkOutcome(
	typeName: ContentTypeName,
	ids: readonly string[],
	outcomes: readonly ItemOutcome[]
): BulkOutcome {
	const results = ids.map((id, index) => {
		const outcome = outcomes[index];
		if (outcome === undefined) {
			throw new Error("write returned too few outcomes");
		}
		return itemProcessingResult(typeName, id, outcome);
	});
	return {
		results,
		wrote: results.some(({ outcome }) => outcome === "ok")
	};
}

// The bulk actions, for one content type: what's wrong with the request as
// a whole (an action the type doesn't have, a missing target collection) is
// a 400; anything wrong with one item is that item's `invalid` result.

// POST: only for the types in BULK_CREATE_REQUESTS.
export async function bulkCreate(
	typeName: ContentTypeName,
	body: unknown,
	editor: EditorRef
): Promise<BulkOutcome> {
	const schema = BULK_CREATE_REQUESTS[typeName];
	if (!schema) {
		throw new Error(`${typeName} has no bulk create`);
	}
	const { items } = schema.parse(body);
	return bulkOutcome(
		typeName,
		items.map(({ createId }) => createId),
		await createEach(typeName, items, editor)
	);
}

// PATCH: one of the type's actions, to every item.
export async function bulkUpdate(
	typeName: ContentTypeName,
	body: unknown,
	editor: EditorRef,
	now = new Date()
): Promise<BulkOutcome> {
	const request = BULK_UPDATE_REQUESTS[typeName].parse(body);
	if (
		request.action === "move" &&
		(
			await collectionsManager.missingCollections(typeName, [
				request.collection
			])
		).length > 0
	) {
		throw new BadRequestError("collection: no such collection");
	}
	const { items } = request;
	return bulkOutcome(
		typeName,
		items.map(({ id }) => id),
		await updateEach(
			typeName,
			items,
			(item) => {
				const ref = itemRef.parse(item);
				return {
					...ref,
					changesFor: changesFromAction(
						typeName,
						request,
						ref.startingRevision,
						now
					)
				};
			},
			editor,
			now
		)
	);
}

// DELETE.
export async function bulkDelete(
	typeName: ContentTypeName,
	body: unknown
): Promise<BulkOutcome> {
	const { items } = bulkDeleteRequest.parse(body);
	return bulkOutcome(
		typeName,
		items.map(({ id }) => id),
		await deleteEach(typeName, items)
	);
}
