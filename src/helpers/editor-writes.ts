// Editor item writes, many items at once; a single write is a batch of one.
// Each item is checked on its own and gets its own outcome, then every valid
// item is written at once. Nothing is rolled back if one item fails.
import * as z from "zod";
import { BadRequestError } from "../errors/bad-request-error.ts";
import * as collectionsManager from "../managers/editor-collections.ts";
import * as editorContent from "../managers/editor-content.ts";
import * as mongoManager from "../managers/mongo-manager.ts";
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

const NO_SUCH_COLLECTION = invalid(
	new BadRequestError("collection: no such collection")
);

/**
 * Deletes again each written item whose collection was deleted after the
 * check, giving it `replacement` instead. Checking after the write closes the
 * race with deleteCollection: a check before its last delete is followed by
 * that delete, and one after it finds the collection gone.
 */
async function dropItemsOfDeletedCollections(
	typeName: ContentTypeName,
	outcomes: readonly ItemOutcome[],
	replacement: ItemOutcome
): Promise<ItemOutcome[]> {
	const collectionOf = (outcome: ItemOutcome) =>
		outcome.outcome === "ok" &&
		typeof outcome.item?.["collection"] === "string"
			? outcome.item["collection"]
			: undefined;
	const named = outcomes.flatMap((outcome) => collectionOf(outcome) ?? []);
	const missing = await collectionsManager.missingCollections(typeName, [
		...new Set(named)
	]);
	if (missing.length === 0) {
		return [...outcomes];
	}
	const isDropped = (outcome: ItemOutcome) =>
		missing.includes(collectionOf(outcome) ?? "");
	await collectionsManager.deleteItemsInCollections(
		typeName,
		outcomes.flatMap((outcome) =>
			isDropped(outcome) && outcome.outcome === "ok" && outcome.item
				? [outcome.item.id]
				: []
		),
		missing
	);
	// A moved item left its public collection.
	await mongoManager.updateContentVersion();
	return outcomes.map((outcome) =>
		isDropped(outcome) ? replacement : outcome
	);
}

// An item's outcome known before writing, or what to write for it.
type Step<T> = { readonly done: ItemOutcome } | { readonly pending: T };

// An item whose `prepare` throws, or whose collection is missing, is invalid;
// `write` gets every other item at once.
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
			? { done: NO_SUCH_COLLECTION }
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

// A repeated createId returns its item unchecked: it may have been valid only
// then (a news date since passed, a collection since deleted).
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
		async (pending) =>
			dropItemsOfDeletedCollections(
				typeName,
				await editorContent.createItems(typeName, pending, editor, now),
				NO_SUCH_COLLECTION
			)
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
			dropItemsOfDeletedCollections(
				typeName,
				(
					await editorContent.updateItems(
						typeName,
						pending,
						editor,
						now
					)
				).map((result) =>
					result.outcome === "rejected"
						? invalid(result.error)
						: result
				),
				{ outcome: "not-found" }
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
