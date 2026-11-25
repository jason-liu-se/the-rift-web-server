// What the drafts routes do around drafts.ts's queries: saving (create or
// update, with the per-editor limits) and publishing a draft as its item or
// collection.
// Another editor's draft is always "not found", never forbidden, so nobody can
// learn that it exists.
import {
	MAX_DRAFTS_PER_USER,
	MAX_DRAFT_BYTES,
	PUBLISHED_DRAFT_TTL_MS
} from "../config/content-limits.ts";
import { BadRequestError } from "../errors/bad-request-error.ts";
import { ConflictError } from "../errors/conflict-error.ts";
import { NotFoundError } from "../errors/not-found-error.ts";
import type { Draft, EditorCollection } from "../contract/api-responses.ts";
import type { EditorRef } from "../models/audit-fields.ts";
import type {
	DraftPublishRequest,
	DraftSaveRequest
} from "../api/draft-requests.ts";
import { FIELD_SCHEMAS, parseUpdate } from "../api/editor-requests.ts";
import {
	type EditorItemBody,
	parseEditorItem,
	draft as draftResponse,
	editorCollection,
	parseResponse
} from "../api/response-schemas.ts";
import { collectionCreateRequest } from "../api/write-schemas.ts";
import {
	itemNotFound,
	writtenCollection,
	writtenItem
} from "./editor-actions.ts";
import { createEach, onlyOutcome, updateEach } from "./editor-writes.ts";
import {
	COLLECTION_DRAFT_TYPES,
	type CollectionTypeName,
	type ContentTypeName,
	type DraftTypeName,
	isCollectionDraftType
} from "../types/editor-content.ts";
import * as collectionsManager from "../managers/editor-collections.ts";
import * as drafts from "../managers/drafts.ts";
import * as editorContent from "../managers/editor-content.ts";

export function draftNotFound(id: string): NotFoundError {
	return new NotFoundError(`draft '${id}'`);
}

/** What publishing a draft answers: its item, or its collection. */
type PublishedBody = EditorItemBody | EditorCollection;

// The item (by ID) or collection (by slug) a draft names, as stored.
async function getPublished(type: DraftTypeName, id: string): Promise<unknown> {
	return isCollectionDraftType(type)
		? collectionsManager.getCollection(COLLECTION_DRAFT_TYPES[type], id)
		: editorContent.getItem(type, id);
}

function parsePublished(
	type: DraftTypeName,
	published: unknown
): PublishedBody {
	return isCollectionDraftType(type)
		? parseResponse(editorCollection, published)
		: parseEditorItem(type, published);
}

function publishedNotFound(type: DraftTypeName, id: string): NotFoundError {
	return isCollectionDraftType(type)
		? new NotFoundError(
				`${COLLECTION_DRAFT_TYPES[type]} collection '${id}'`
			)
		: itemNotFound(type, id);
}

// The owner's unpublished draft, or a 404.
export async function getOwnDraft(
	owner: string,
	id: string
): Promise<drafts.StoredDraft> {
	const stored = await drafts.getDraft(owner, id);
	if (!stored || stored.publishedAs) {
		throw draftNotFound(id);
	}
	return stored;
}

function checkSize(fields: object): void {
	if (Buffer.byteLength(JSON.stringify(fields)) > MAX_DRAFT_BYTES) {
		throw new BadRequestError(
			`fields: a draft holds at most ${MAX_DRAFT_BYTES / 1024} KB`
		);
	}
}

// A repeated create (no startingRevision, its response lost) saves nothing
// and returns the draft as stored.
export async function saveDraft(
	owner: string,
	id: string,
	body: DraftSaveRequest
): Promise<{ created: boolean; draft: Draft }> {
	checkSize(body.fields);

	const stored = await drafts.getDraft(owner, id);
	if (!stored) {
		// A save of a draft that's gone (deleted, or published and its marker
		// expired) mustn't make it again: its publish would return the old item.
		if (body.startingRevision !== undefined) {
			throw draftNotFound(id);
		}
		return { created: true, draft: await createDraft(owner, id, body) };
	}
	if (stored.publishedAs) {
		throw new ConflictError("the draft was already published");
	}
	if (stored.type !== body.type) {
		throw new BadRequestError("type: a draft's type can't change");
	}
	if (body.startingRevision === undefined) {
		return { created: false, draft: parseResponse(draftResponse, stored) };
	}

	const result = await drafts.updateDraft(
		owner,
		id,
		body.startingRevision,
		body.fields
	);
	if (result.outcome !== "ok") {
		return staleSave(owner, id);
	}
	return {
		created: false,
		draft: parseResponse(draftResponse, result.draft)
	};
}

// A save that lost to another device's: 409 with the draft as it is now.
async function staleSave(owner: string, id: string): Promise<never> {
	throw new ConflictError(
		"the draft was saved elsewhere since",
		parseResponse(draftResponse, await getOwnDraft(owner, id))
	);
}

async function createDraft(
	owner: string,
	id: string,
	body: DraftSaveRequest
): Promise<Draft> {
	if (await drafts.draftIdTaken(id)) {
		throw draftNotFound(id);
	}
	if ((await drafts.countDrafts(owner)) >= MAX_DRAFTS_PER_USER) {
		throw new BadRequestError(
			`you have ${MAX_DRAFTS_PER_USER} drafts; publish or delete some first`
		);
	}
	const { target } = body;
	if (target && !(await getPublished(body.type, target.id))) {
		throw publishedNotFound(body.type, target.id);
	}

	const result = await drafts.createDraft({
		id,
		owner,
		type: body.type,
		fields: body.fields,
		target
	});
	if (result.outcome !== "ok") {
		// The owner already has an edit draft of this item: send it, so the
		// editor can carry on with it. Otherwise the ID was taken since the
		// check above, which is as good as another editor's.
		const existing =
			target &&
			(await drafts.getTargetDraft(owner, body.type, target.id));
		if (!existing) {
			throw draftNotFound(id);
		}
		throw new ConflictError(
			"you already have a draft of this item",
			parseResponse(draftResponse, existing)
		);
	}
	return parseResponse(draftResponse, result.draft);
}

// Checks the draft fully, then creates or updates its item (or collection)
// and marks the draft published. A repeat returns the same item without
// writing (`wrote: false`).
export async function publishDraft(
	editor: EditorRef,
	id: string,
	options: DraftPublishRequest
): Promise<{ item: PublishedBody | undefined; wrote: boolean }> {
	const stored = await drafts.getDraft(editor.id, id);
	if (!stored) {
		throw draftNotFound(id);
	}
	const { type } = stored;
	if (stored.publishedAs) {
		const published = await getPublished(type, stored.publishedAs);
		if (!published) {
			throw draftNotFound(id);
		}
		return { item: parsePublished(type, published), wrote: false };
	}

	const now = new Date();
	const { item, publishedAs } = isCollectionDraftType(type)
		? await writeCollection(
				COLLECTION_DRAFT_TYPES[type],
				stored,
				options,
				editor
			)
		: await writeItem(type, stored, options, editor, now);
	if (publishedAs !== undefined) {
		await drafts.markPublished(
			editor.id,
			id,
			stored.revision,
			publishedAs,
			new Date(now.getTime() + PUBLISHED_DRAFT_TTL_MS)
		);
	}
	return { item, wrote: true };
}

/** What a publish wrote, and the ID (or slug) its draft's marker names. */
interface Published {
	readonly item: PublishedBody | undefined;
	readonly publishedAs: string | undefined;
}

// Creates the draft's collection (a new-collection draft, or `asNew`), or
// updates the one an edit draft started from, at the revision it started
// from. An edit draft's slug is always its target's: a slug never changes.
async function writeCollection(
	typeName: CollectionTypeName,
	stored: drafts.StoredDraft,
	{ visible, asNew }: DraftPublishRequest,
	editor: EditorRef
): Promise<Published> {
	const { target } = stored;
	// Every field is required, as for a create.
	const { slug, ...changes } = collectionCreateRequest.parse({
		...stored.fields,
		...(visible !== undefined && { visible }),
		...(target && { slug: target.id })
	});
	const result =
		!target || asNew
			? await collectionsManager.createCollection(
					typeName,
					{ slug, ...changes, createId: stored.id },
					editor
				)
			: await collectionsManager.updateCollection(
					typeName,
					slug,
					target.startingRevision,
					changes,
					editor
				);
	const collection = writtenCollection(typeName, slug, result);
	return { item: collection, publishedAs: collection?.slug };
}

// Creates the draft's item (a new-item draft, or `asNew`), or updates the
// item an edit draft started from, at the revision it started from.
async function writeItem(
	type: ContentTypeName,
	stored: drafts.StoredDraft,
	options: DraftPublishRequest,
	editor: EditorRef,
	now: Date
): Promise<Published> {
	const result = await writeItemOutcome(type, stored, options, editor, now);
	return {
		item: writtenItem(type, stored.target?.id ?? stored.id, result),
		publishedAs:
			result.outcome === "ok" && result.item ? result.item.id : undefined
	};
}

async function writeItemOutcome(
	type: ContentTypeName,
	stored: drafts.StoredDraft,
	{ visible, date, asNew }: DraftPublishRequest,
	editor: EditorRef,
	now: Date
) {
	const body = {
		...stored.fields,
		...(visible !== undefined && { visible }),
		...(date !== undefined && { date })
	};
	const { target } = stored;
	if (!target || asNew) {
		return onlyOutcome(
			await createEach(
				type,
				[{ ...body, createId: stored.id }],
				editor,
				now
			)
		);
	}

	// Every field is required, as for a create.
	FIELD_SCHEMAS[type].full.parse(stored.fields ?? {});
	return onlyOutcome(
		await updateEach(
			type,
			[{ ...body, startingRevision: target.startingRevision }],
			(item) => {
				const { startingRevision, fields, changesFor } = parseUpdate(
					type,
					item,
					now
				);
				return {
					id: target.id,
					startingRevision,
					changesFor,
					collection: fields["collection"]
				};
			},
			editor,
			now
		)
	);
}
