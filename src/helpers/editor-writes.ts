// Editor item writes, many items at once; a single write is a batch of one.
// Each item is checked on its own and gets its own outcome, then every valid
// item is written at once. Nothing is rolled back if one item fails.
import * as z from "zod";
import { BadRequestError } from "../errors/bad-request-error.ts";
import * as collectionsManager from "../managers/editor-collections.ts";
import * as editorContent from "../managers/editor-content.ts";
import type {
	ContentTypeName,
	Invalid,
	ItemOutcome,
	ItemUpdate,
	NewItem
} from "../types/editor-content.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import { parseCreate } from "../api/editor-requests.ts";
import { idParams } from "../api/query-schemas.ts";
import { startingRevision } from "../api/write-schemas.ts";

/** A create's item: its createId and the rest of its body, unchecked. */
export interface NewItemBody {
	readonly createId: string;
	readonly [field: string]: unknown;
}

/** An update to write, and the collection it moves the item to, if any. */
export interface PlannedUpdate extends ItemUpdate {
	readonly collection?: unknown;
}

export const itemRef = idParams.extend({ startingRevision });

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
	const missingCollections = await collectionsManager.missingCollections(
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
