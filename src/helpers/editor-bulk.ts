// Bulk actions (POST /editor/<items>/bulk): one request, many items, one
// response once every item is processed. Each item is checked and written on
// its own, through the same functions as single writes, and gets its own
// result; nothing is rolled back if a later item fails.
import * as z from "zod";
import { MAX_BULK_ITEMS } from "../config/requests.ts";
import { BadRequestError } from "../errors/bad-request-error.ts";
import * as editorContent from "../managers/editor-content.ts";
import type {
	CollectionTypeName,
	ContentTypeName,
	CreateResult,
	FieldChanges,
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
import { startRevision, tagList } from "../api/write-schemas.ts";

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

const itemRef = idParams.extend({ startRevision });

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

// Runs `write` for an item, reporting a bad item as invalid rather than
// failing the request.
async function settle(
	id: string,
	write: () => Promise<BulkItemResult<unknown>>
): Promise<BulkItemResult<unknown>> {
	try {
		return await write();
	} catch (error) {
		if (error instanceof z.ZodError) {
			return { id, outcome: "invalid", reason: problemsOf(error) };
		}
		if (error instanceof BadRequestError) {
			return { id, outcome: "invalid", reason: error.message };
		}
		throw error;
	}
}

// The changes an update action makes to one stored item.
function changesFor(
	typeName: ContentTypeName,
	request: BulkRequest,
	startRevision: number,
	now: Date
): (current: StoredItem) => FieldChanges {
	switch (request.action) {
		case "show":
		case "hide":
			return parseUpdate(
				typeName,
				{ startRevision, visible: request.action === "show" },
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

async function createAll(
	typeName: CollectionTypeName,
	request: BulkRequest,
	editor: EditorRef,
	now: Date
): Promise<BulkItemResult<unknown>[]> {
	const slugs = request.items.flatMap(({ collection }) =>
		typeof collection === "string" ? [collection] : []
	);
	const missing = await editorContent.missingCollections(typeName, [
		...new Set(slugs)
	]);

	const results: BulkItemResult<unknown>[] = [];
	// In order, so the images' ObjectIds (their newest-first order) follow it.
	for (const { id, ...fields } of request.items) {
		results.push(
			await settle(id, async () => {
				const { createId, fields: parsed } = parseCreate(
					typeName,
					{ ...fields, createId: id },
					now
				);
				if (missing.includes(String(parsed["collection"]))) {
					throw new BadRequestError("collection: no such collection");
				}
				return itemResult(
					typeName,
					id,
					await editorContent.createItem(
						typeName,
						createId,
						parsed,
						editor,
						now
					)
				);
			})
		);
	}
	return results;
}

async function updateAll(
	typeName: ContentTypeName,
	request: BulkRequest,
	editor: EditorRef,
	now: Date
): Promise<BulkItemResult<unknown>[]> {
	const results: BulkItemResult<unknown>[] = [];
	for (const item of request.items) {
		results.push(
			await settle(item.id, async () => {
				const { id, startRevision } = itemRef.parse(item);
				const result =
					request.action === "delete"
						? await editorContent.deleteItem(
								typeName,
								id,
								startRevision,
								now
							)
						: await editorContent.updateItem(
								typeName,
								id,
								startRevision,
								changesFor(
									typeName,
									request,
									startRevision,
									now
								),
								editor,
								now
							);
				return itemResult(typeName, id, result);
			})
		);
	}
	return results;
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
