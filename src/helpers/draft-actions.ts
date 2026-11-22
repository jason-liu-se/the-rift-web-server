// What the drafts routes do around drafts.ts's queries: saving (create or
// update, with the per-editor limits) and publishing a draft as its item.
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
import type { EditorRef } from "../models/audit-fields.ts";
import {
	type DraftPublishRequest,
	type DraftSaveRequest,
	contentType
} from "../api/draft-requests.ts";
import { FIELD_SCHEMAS, parseUpdate } from "../api/editor-requests.ts";
import {
	EDITOR_ITEM_SCHEMAS,
	draft as draftResponse,
	parseResponse
} from "../api/response-schemas.ts";
import { itemNotFound, writtenItem } from "./editor-actions.ts";
import { createEach, onlyOutcome, updateEach } from "./editor-bulk.ts";
import type { ContentTypeName } from "../types/editor-content.ts";
import * as drafts from "../managers/drafts.ts";
import * as editorContent from "../managers/editor-content.ts";

export function draftNotFound(id: string): NotFoundError {
	return new NotFoundError(`draft '${id}'`);
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

// Creates the draft, or saves it from the revision the client last saw. A
// repeated create (no revision, its response lost) saves nothing and returns
// the draft as it is, for the website to carry on from or reconcile.
export async function saveDraft(
	owner: string,
	id: string,
	body: DraftSaveRequest
): Promise<{ created: boolean; draft: unknown }> {
	checkSize(body.fields);

	const stored = await drafts.getDraft(owner, id);
	if (!stored) {
		return { created: true, draft: await createDraft(owner, id, body) };
	}
	if (stored.publishedAs) {
		throw new ConflictError("the draft was already published");
	}
	if (stored.type !== body.type) {
		throw new BadRequestError("type: a draft's type can't change");
	}
	if (body.revision === undefined) {
		return { created: false, draft: parseResponse(draftResponse, stored) };
	}

	const result = await drafts.updateDraft(
		owner,
		id,
		body.revision,
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
): Promise<unknown> {
	if (await drafts.draftIdTaken(id)) {
		throw draftNotFound(id);
	}
	if ((await drafts.countDrafts(owner)) >= MAX_DRAFTS_PER_USER) {
		throw new BadRequestError(
			`you have ${MAX_DRAFTS_PER_USER} drafts; publish or delete some first`
		);
	}
	const { target } = body;
	if (target && !(await editorContent.getItem(body.type, target.id))) {
		throw itemNotFound(body.type, target.id);
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

// Checks the draft fully, then creates or updates its item and marks the
// draft published. A repeat returns the same item without writing
// (`wrote: false`).
export async function publishDraft(
	editor: EditorRef,
	id: string,
	options: DraftPublishRequest
): Promise<{ item: unknown; wrote: boolean }> {
	const stored = await drafts.getDraft(editor.id, id);
	if (!stored) {
		throw draftNotFound(id);
	}
	const parsedType = contentType.safeParse(stored.type);
	if (!parsedType.success) {
		throw new Error(`draft '${id}' has an unknown type`);
	}
	const type = parsedType.data;
	if (stored.publishedAs) {
		const item = await editorContent.getItem(type, stored.publishedAs);
		if (!item) {
			throw draftNotFound(id);
		}
		return {
			item: parseResponse(EDITOR_ITEM_SCHEMAS[type], item),
			wrote: false
		};
	}

	const now = new Date();
	const result = await writeItem(type, stored, options, editor, now);
	const item = writtenItem(type, stored.target?.id ?? id, result);
	if (result.outcome === "ok" && result.item) {
		await drafts.markPublished(
			editor.id,
			id,
			stored.revision,
			result.item.id,
			new Date(now.getTime() + PUBLISHED_DRAFT_TTL_MS)
		);
	}
	return { item, wrote: true };
}

// Creates the draft's item (a new-item draft, or `asNew`), or updates the
// item an edit draft started from, at the revision it started from.
async function writeItem(
	type: ContentTypeName,
	stored: drafts.StoredDraft,
	{ visible, date, asNew }: DraftPublishRequest,
	editor: EditorRef,
	now: Date
) {
	const body = { ...stored.fields, visible, date };
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
			[{ ...body, revision: target.revision }],
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
