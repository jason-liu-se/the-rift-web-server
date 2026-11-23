// Bulk actions (POST /editor/<items>/bulk): one request, many items, one
// response once every item is processed. Each item is checked on its own and
// gets its own result; then every valid item is written at once, through the
// same editor-content functions as single writes (a single write is a batch
// of one). Nothing is rolled back if one item fails.
import * as z from "zod";
import { MAX_BULK_ITEMS } from "../config/requests.ts";
import { BadRequestError } from "../errors/bad-request-error.ts";
import * as editorContent from "../managers/editor-content.ts";
import type {
	CollectionTypeName,
	ContentTypeName,
	CreateResult,
	FieldChanges,
	NewItem,
	StoredItem,
	WriteResult
} from "../managers/editor-content.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import type { BulkItemResult } from "../contract/api-responses.ts";
import { MAX_TAGS_PER_IMAGE } from "../config/content-limits.ts";
import { parseCreate, parseUpdate } from "../api/editor-requests.ts";
import {
	collectionSlug,
	idParams,
	normaliseTags
} from "../api/query-schemas.ts";
import { EDITOR_ITEM_SCHEMAS, parseResponse } from "../api/response-schemas.ts";
import { startingRevision, tagList } from "../api/write-schemas.ts";

// Every item names itself, so its result can; the rest of it is checked per
// item, so one bad item doesn't refuse the others.
const items = z
	.array(z.looseObject({ id: z.string().min(1).max(64) }))
	.min(1, "items: at least one item")
	.max(MAX_BULK_ITEMS, `items: at most ${MAX_BULK_ITEMS} items`);

const bulkRequest = z.discriminatedUnion("action", [
	z.object({ action: z.enum(["delete", "show", "hide"]), items }),
	z.object({ action: z.literal("move"), collection: collectionSlug, items }),
	z.object({
		action: z.enum(["add-tags", "remove-tags"]),
		tags: tagList.pipe(z.array(z.string()).min(1, "at least one tag")),
		items
	}),
	z.object({ action: z.literal("create"), items })
]);

type BulkRequest = z.infer<typeof bulkRequest>;
type BulkAction = BulkRequest["action"];

// The actions each type allows beyond delete, show, and hide.
const EXTRA_ACTIONS: Readonly<Record<ContentTypeName, readonly BulkAction[]>> =
	{
		news: [],
		gallery: ["move", "add-tags", "remove-tags", "create"],
		downloads: ["move"],
		maps: []
	};

const itemRef = idParams.extend({ startingRevision });

function problemsOf(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("; ");
}

// An item's result, sending its item through the type's response schema.
function itemResult(
	typeName: ContentTypeName,
	id: string,
	result: WriteResult | CreateResult
): BulkItemResult<unknown> {
	const schema = EDITOR_ITEM_SCHEMAS[typeName];
	switch (result.outcome) {
		case "ok":
			return {
				id,
				outcome: "ok",
				...(result.item && { item: parseResponse(schema, result.item) })
			};
		case "conflict":
			return {
				id,
				outcome: "conflict",
				current: parseResponse(schema, result.current)
			};
		case "not-found":
			return { id, outcome: "not-found" };
		case "duplicate":
			return {
				id,
				outcome: "invalid",
				reason: `${result.field}: already taken`
			};
	}
}

// A bad item's result, for a request schema's or a check's error; any other
// error fails the request.
function invalid(id: string, error: unknown): BulkItemResult<unknown> {
	if (error instanceof z.ZodError) {
		return { id, outcome: "invalid", reason: problemsOf(error) };
	}
	if (error instanceof BadRequestError) {
		return { id, outcome: "invalid", reason: error.message };
	}
	throw error;
}

// An item's result known before writing, or what to write for it.
type Step<T> =
	{ readonly done: BulkItemResult<unknown> } | { readonly pending: T };

// Every item's result, in request order. `prepare` checks each item on its
// own (throwing makes it `invalid`); `write` then writes every pending item
// at once, returning a result for each.
async function inOrder<I extends { readonly id: string }, T, R>(
	items: readonly I[],
	prepare: (item: I) => Step<T>,
	write: (pending: readonly T[]) => Promise<readonly R[]>,
	toResult: (id: string, result: R) => BulkItemResult<unknown>
): Promise<BulkItemResult<unknown>[]> {
	const steps = items.map((item): Step<T> => {
		try {
			return prepare(item);
		} catch (error) {
			return { done: invalid(item.id, error) };
		}
	});
	const written = await write(
		steps.flatMap((step) => ("pending" in step ? [step.pending] : []))
	);
	let next = 0;
	return steps.map((step, index) => {
		if ("done" in step) {
			return step.done;
		}
		const result = written[next++];
		const id = items[index]?.id;
		if (result === undefined || id === undefined) {
			throw new Error("bulk write returned too few results");
		}
		return toResult(id, result);
	});
}

// The changes an update action makes to one stored item.
function changesFor(
	typeName: ContentTypeName,
	request: BulkRequest,
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
				const next = normaliseTags(
					action === "add-tags"
						? [...stored, ...tags]
						: stored.filter((tag) => !tags.includes(tag))
				);
				if (next.length > MAX_TAGS_PER_IMAGE) {
					throw new BadRequestError(
						`tags: at most ${MAX_TAGS_PER_IMAGE} tags`
					);
				}
				return { tags: next };
			};
		}
		default:
			throw new Error(`${request.action} isn't an update`);
	}
}

// A repeated createId returns the item it made without checking the item
// again, as a single create does.
async function createAll(
	typeName: CollectionTypeName,
	request: BulkRequest,
	editor: EditorRef,
	now: Date
): Promise<BulkItemResult<unknown>[]> {
	const slugs = request.items.flatMap(({ collection }) =>
		typeof collection === "string" ? [collection] : []
	);
	const [made, missing] = await Promise.all([
		editorContent.findCreated(
			typeName,
			request.items.map(({ id }) => id),
			now
		),
		editorContent.missingCollections(typeName, [...new Set(slugs)])
	]);

	return inOrder(
		request.items,
		({ id, ...fields }): Step<NewItem> => {
			const repeat = made.get(id);
			if (repeat) {
				return { done: itemResult(typeName, id, repeat) };
			}
			const created = parseCreate(
				typeName,
				{ ...fields, createId: id },
				now
			);
			if (missing.includes(String(created.fields["collection"]))) {
				throw new BadRequestError("collection: no such collection");
			}
			return { pending: created };
		},
		(pending) => editorContent.createItems(typeName, pending, editor, now),
		(id, result) => itemResult(typeName, id, result)
	);
}

async function updateAll(
	typeName: ContentTypeName,
	request: BulkRequest,
	editor: EditorRef,
	now: Date
): Promise<BulkItemResult<unknown>[]> {
	if (request.action === "delete") {
		return inOrder(
			request.items,
			(item) => ({ pending: itemRef.parse(item) }),
			(pending) => editorContent.deleteItems(typeName, pending, now),
			(id, result) => itemResult(typeName, id, result)
		);
	}
	return inOrder(
		request.items,
		(item) => {
			const ref = itemRef.parse(item);
			return {
				pending: {
					...ref,
					changesFor: changesFor(
						typeName,
						request,
						ref.startingRevision,
						now
					)
				}
			};
		},
		(pending) => editorContent.updateItems(typeName, pending, editor, now),
		(id, result) =>
			result.outcome === "rejected"
				? invalid(id, result.error)
				: itemResult(typeName, id, result)
	);
}

export interface BulkOutcome {
	readonly results: BulkItemResult<unknown>[];
	/** Whether any item was written, so the content version must change. */
	readonly wrote: boolean;
}

// Parses and runs a bulk request for one content type. A request that's
// wrong as a whole (an unknown action, a missing target collection) is a 400;
// anything wrong with one item is that item's `invalid` result.
export async function runBulkAction(
	typeName: ContentTypeName,
	body: unknown,
	editor: EditorRef,
	now = new Date()
): Promise<BulkOutcome> {
	const request = bulkRequest.parse(body);
	const { action } = request;
	if (
		!["delete", "show", "hide"].includes(action) &&
		!EXTRA_ACTIONS[typeName].includes(action)
	) {
		throw new BadRequestError(`action: ${action} isn't available here`);
	}
	if (
		request.action === "move" &&
		(typeName === "gallery" || typeName === "downloads") &&
		(await editorContent.missingCollections(typeName, [request.collection]))
			.length > 0
	) {
		throw new BadRequestError("collection: no such collection");
	}

	const results =
		action === "create" && typeName === "gallery"
			? await createAll(typeName, request, editor, now)
			: await updateAll(typeName, request, editor, now);
	return {
		results,
		wrote: results.some(({ outcome }) => outcome === "ok")
	};
}
