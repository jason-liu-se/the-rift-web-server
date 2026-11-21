// Drafts (/editor/drafts): an editor's unpublished work, private to them.
// Another editor's draft is a 404, never a 403, so nobody can learn that it
// exists. Never cached (the app-wide no-store), unlike the editor's other
// reads.
import express from "express";
import * as z from "zod";
import {
	MAX_DRAFTS_PER_USER,
	MAX_DRAFT_BYTES,
	PUBLISHED_DRAFT_TTL_MS
} from "../config/content-limits.ts";
import type { DraftListQuery } from "../contract/api-requests.ts";
import { BadRequestError } from "../errors/bad-request-error.ts";
import { ConflictError } from "../errors/conflict-error.ts";
import { NotFoundError } from "../errors/not-found-error.ts";
import * as drafts from "../managers/drafts.ts";
import * as editorContent from "../managers/editor-content.ts";
import { CONTENT_TYPE_NAMES } from "../managers/editor-content.ts";
import * as mongoManager from "../managers/mongo-manager.ts";
import { FIELD_SCHEMAS, parseUpdate } from "../api/editor-requests.ts";
import { idParams, queryFor } from "../api/query-schemas.ts";
import {
	EDITOR_ITEM_SCHEMAS,
	draft as draftResponse,
	draftSummaries,
	parseResponse
} from "../api/response-schemas.ts";
import {
	downloadItemFields,
	galleryImageFields,
	mapSeasonFields,
	newsDate,
	newsPostFields,
	revision
} from "../api/write-schemas.ts";
import { editorOf, writtenItem } from "../helpers/editor-actions.ts";
import { createEach, onlyOutcome, updateEach } from "../helpers/editor-bulk.ts";
import type { ContentTypeName } from "../types/editor-content.ts";

const contentType = z.enum(CONTENT_TYPE_NAMES);

const draftParams = z.object({ id: z.uuid("invalid id") });

const draftsQuery = queryFor<DraftListQuery>()({
	type: contentType.optional()
});

const saveOptions = {
	revision: revision.optional(),
	target: idParams.extend({ revision }).optional()
};

// What a save sends: the fields, checked only for types and limits.
const draftSaveRequest = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("news"),
		fields: newsPostFields.draft,
		...saveOptions
	}),
	z.object({
		type: z.literal("gallery"),
		fields: galleryImageFields.draft,
		...saveOptions
	}),
	z.object({
		type: z.literal("downloads"),
		fields: downloadItemFields.draft,
		...saveOptions
	}),
	z.object({
		type: z.literal("maps"),
		fields: mapSeasonFields.draft,
		...saveOptions
	})
]);

const draftPublishRequest = z.object({
	visible: z.boolean(),
	date: newsDate.optional(),
	asNew: z.boolean().optional()
});

function notFound(id: string): NotFoundError {
	return new NotFoundError(`draft '${id}'`);
}

function checkSize(fields: object): void {
	if (Buffer.byteLength(JSON.stringify(fields)) > MAX_DRAFT_BYTES) {
		throw new BadRequestError(
			`fields: a draft holds at most ${MAX_DRAFT_BYTES / 1024} KB`
		);
	}
}

// A save that lost to another device's: 409 with the draft as it is now.
async function staleSave(owner: string, id: string): Promise<never> {
	const current = await drafts.getDraft(owner, id);
	if (!current || current.publishedAs) {
		throw notFound(id);
	}
	throw new ConflictError(
		"the draft was saved elsewhere since",
		parseResponse(draftResponse, current)
	);
}

export const draftsRouter = express.Router();

draftsRouter.get("/", async (req, res) => {
	const { type } = draftsQuery.parse(req.query);

	res.json(
		parseResponse(
			draftSummaries,
			await drafts.listDrafts(editorOf(res).id, type)
		)
	);
});

draftsRouter.get("/:id", async (req, res) => {
	const { id } = draftParams.parse(req.params);

	const stored = await drafts.getDraft(editorOf(res).id, id);
	if (!stored || stored.publishedAs) {
		throw notFound(id);
	}
	res.json(parseResponse(draftResponse, stored));
});

// Creates the draft (201), or saves it from the revision the client last saw.
// A repeated create is 200 with the draft already made.
draftsRouter.put("/:id", async (req, res) => {
	const { id } = draftParams.parse(req.params);
	const body = draftSaveRequest.parse(req.body);
	const owner = editorOf(res).id;
	checkSize(body.fields);

	const stored = await drafts.getDraft(owner, id);
	if (!stored) {
		res.status(201).json(await createDraft(owner, id, body));
		return;
	}
	if (stored.publishedAs) {
		throw new ConflictError("the draft was already published");
	}
	if (stored.type !== body.type) {
		throw new BadRequestError("type: a draft's type can't change");
	}
	if (body.revision === undefined) {
		// A repeated create (its response lost): the draft as it is, saving
		// nothing, for the website to carry on from or reconcile.
		res.json(parseResponse(draftResponse, stored));
		return;
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
	res.json(parseResponse(draftResponse, result.draft));
});

async function createDraft(
	owner: string,
	id: string,
	body: z.infer<typeof draftSaveRequest>
): Promise<unknown> {
	if (await drafts.draftIdTaken(id)) {
		throw notFound(id);
	}
	if ((await drafts.countDrafts(owner)) >= MAX_DRAFTS_PER_USER) {
		throw new BadRequestError(
			`you have ${MAX_DRAFTS_PER_USER} drafts; publish or delete some first`
		);
	}
	const { target } = body;
	if (target && !(await editorContent.getItem(body.type, target.id))) {
		const { itemName } = editorContent.CONTENT_TYPES[body.type];
		throw new NotFoundError(`${itemName} '${target.id}'`);
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
			throw notFound(id);
		}
		throw new ConflictError(
			"you already have a draft of this item",
			parseResponse(draftResponse, existing)
		);
	}
	return parseResponse(draftResponse, result.draft);
}

draftsRouter.delete("/:id", async (req, res) => {
	const { id } = draftParams.parse(req.params);

	if (!(await drafts.deleteDraft(editorOf(res).id, id))) {
		throw notFound(id);
	}
	res.sendStatus(204);
});

// Checks the draft fully, then creates or updates its item and marks the
// draft published. Repeating it returns the same item.
draftsRouter.post("/:id/publish", async (req, res) => {
	const { id } = draftParams.parse(req.params);
	const options = draftPublishRequest.parse(req.body);
	const editor = editorOf(res);

	const stored = await drafts.getDraft(editor.id, id);
	if (!stored) {
		throw notFound(id);
	}
	const parsedType = contentType.safeParse(stored.type);
	if (!parsedType.success) {
		throw new Error(`draft '${id}' has an unknown type`);
	}
	const type = parsedType.data;
	const schema = EDITOR_ITEM_SCHEMAS[type];
	if (stored.publishedAs) {
		const item = await editorContent.getItem(type, stored.publishedAs);
		if (!item) {
			throw notFound(id);
		}
		res.json(parseResponse(schema, item));
		return;
	}

	const now = new Date();
	const result = await publish(type, stored, options, editor, now);
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
	await mongoManager.updateContentVersion();
	res.json(item);
});

// Creates the draft's item (a new-item draft, or `asNew`), or updates the
// item an edit draft started from, at the revision it started from.
async function publish(
	type: ContentTypeName,
	stored: drafts.StoredDraft,
	{ visible, date, asNew }: z.infer<typeof draftPublishRequest>,
	editor: ReturnType<typeof editorOf>,
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
