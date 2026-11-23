// Editor item writes, many items at once: the bulk actions
// (/editor/<items>/bulk) and the single writes alike, which are a batch of
// one. Each item is checked on its own and gets its own outcome; then every
// valid item is written at once, through editor-content. Nothing is rolled
// back if one item fails.
import * as z from "zod";
import { BadRequestError } from "../errors/bad-request-error.ts";
import * as editorContent from "../managers/editor-content.ts";
import type {
	ContentTypeName,
	CreateResult,
	FieldChanges,
	ItemUpdate,
	NewItem,
	StoredItem,
	WriteResult
} from "../managers/editor-content.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import type { BulkItemResult } from "../contract/api-responses.ts";
import { MAX_TAGS_PER_IMAGE } from "../config/content-limits.ts";
import {
	BULK_CREATE_REQUESTS,
	BULK_UPDATE_REQUESTS,
	type BulkUpdateRequest,
	bulkDeleteRequest
} from "../api/bulk-requests.ts";
import { parseCreate, parseUpdate } from "../api/editor-requests.ts";
import { idParams, normaliseTags } from "../api/query-schemas.ts";
import { EDITOR_ITEM_SCHEMAS, parseResponse } from "../api/response-schemas.ts";
import { startingRevision } from "../api/write-schemas.ts";

/** An item refused before writing, with why (a single write's 400). */
export interface Invalid {
	readonly outcome: "invalid";
	readonly error: unknown;
}

export type ItemOutcome = WriteResult | CreateResult | Invalid;

/** A create's item: its createId and the rest of its body, unchecked. */
export interface NewItemBody {
	readonly createId: string;
	readonly [field: string]: unknown;
}

/** An update to write, and the collection it moves the item to, if any. */
export interface PlannedUpdate extends ItemUpdate {
	readonly collection?: unknown;
}

const itemRef = idParams.extend({ startingRevision });

// A request schema's or a check's error refuses only its item; any other
// error fails the request.
function invalid(error: unknown): Invalid {
	if (error instanceof z.ZodError || error instanceof BadRequestError) {
		return { outcome: "invalid", error };
	}
	throw error;
}

// An item's outcome known before writing, or what to write for it.
type Step<T> = { readonly done: ItemOutcome } | { readonly pending: T };

// Every item's outcome, in request order. `prepare` checks each item on its
// own (throwing makes it `invalid`), as does one query for the collections
// the pending items name (`collectionOf`); `write` then writes every pending
// item at once, returning an outcome for each.
async function processInOrder<I, T>(
	typeName: ContentTypeName,
	items: readonly I[],
	prepare: (item: I) => Step<T>,
	collectionOf: (pending: T) => unknown,
	write: (pending: readonly T[]) => Promise<readonly ItemOutcome[]>
): Promise<ItemOutcome[]> {
	const prepared = items.map((item): Step<T> => {
		try {
			return prepare(item);
		} catch (error) {
			return { done: invalid(error) };
		}
	});
	const named = prepared.flatMap((step) => {
		const collection = "pending" in step && collectionOf(step.pending);
		return typeof collection === "string" ? [collection] : [];
	});
	const missingCollections = await editorContent.missingCollections(
		typeName,
		[...new Set(named)]
	);
	const steps = prepared.map((step): Step<T> => {
		const collection = "pending" in step && collectionOf(step.pending);
		return typeof collection === "string" &&
			missingCollections.includes(collection)
			? {
					done: invalid(
						new BadRequestError("collection: no such collection")
					)
				}
			: step;
	});

	const written = await write(
		steps.flatMap((step) => ("pending" in step ? [step.pending] : []))
	);
	let pendingIndex = 0;
	return steps.map((step) => {
		if ("done" in step) {
			return step.done;
		}
		const outcome = written[pendingIndex++];
		if (outcome === undefined) {
			throw new Error("write returned too few outcomes");
		}
		return outcome;
	});
}

// Creates every item. A repeated createId returns the item it made without
// checking the item again: the first may have been valid only then (a news
// date since passed, a collection since deleted).
export async function createEach(
	typeName: ContentTypeName,
	items: readonly NewItemBody[],
	editor: EditorRef,
	now = new Date()
): Promise<ItemOutcome[]> {
	const createdDocs = await editorContent.findCreated(
		typeName,
		items.map(({ createId }) => createId),
		now
	);
	return processInOrder(
		typeName,
		items,
		(item): Step<NewItem> => {
			const repeat = createdDocs.get(item.createId);
			return repeat
				? { done: repeat }
				: { pending: parseCreate(typeName, item, now) };
		},
		({ fields }) => fields["collection"],
		(pending) => editorContent.createItems(typeName, pending, editor, now)
	);
}

// Updates every item, as `prepare` plans it from the item. A `changesFor`
// that throws anything but a request error (ZodError, BadRequestError) fails
// the whole request, after the other items were written.
export async function updateEach<I>(
	typeName: ContentTypeName,
	items: readonly I[],
	prepare: (item: I) => PlannedUpdate,
	editor: EditorRef,
	now = new Date()
): Promise<ItemOutcome[]> {
	return processInOrder(
		typeName,
		items,
		(item) => ({ pending: prepare(item) }),
		({ collection }) => collection,
		async (pending) =>
			(
				await editorContent.updateItems(typeName, pending, editor, now)
			).map((result) =>
				result.outcome === "rejected" ? invalid(result.error) : result
			)
	);
}

// Deletes every item (each `{ id, startingRevision }`).
export async function deleteEach(
	typeName: ContentTypeName,
	items: readonly unknown[],
	now = new Date()
): Promise<ItemOutcome[]> {
	return processInOrder(
		typeName,
		items,
		(item) => ({ pending: itemRef.parse(item) }),
		() => undefined,
		(pending) => editorContent.deleteItems(typeName, pending, now)
	);
}

// A single write's outcome, from its batch of one.
export function onlyOutcome(outcomes: readonly ItemOutcome[]): ItemOutcome {
	const [outcome] = outcomes;
	if (outcome === undefined || outcomes.length !== 1) {
		throw new Error("expected one write outcome");
	}
	return outcome;
}

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
): BulkItemResult<unknown> {
	const schema = EDITOR_ITEM_SCHEMAS[typeName];
	switch (outcome.outcome) {
		case "ok":
			return {
				id,
				outcome: "ok",
				...(outcome.item && {
					item: parseResponse(schema, outcome.item)
				})
			};
		case "conflict":
			return {
				id,
				outcome: "conflict",
				current: parseResponse(schema, outcome.current)
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
	readonly results: BulkItemResult<unknown>[];
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
		(await editorContent.missingCollections(typeName, [request.collection]))
			.length > 0
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
