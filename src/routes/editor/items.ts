// A content type's items in the editor tools (/editor/news,
// /editor/gallery/images, ...; every one needs a login): list, read, create,
// update, delete, and bulk actions. One router per type, built from the same
// pieces: what differs per type lives in CONTENT_TYPES
// (src/managers/editor-content.ts).
import express, { type Router } from "express";
import { ZodError } from "zod";
import { BadRequestError } from "../../errors/bad-request-error.ts";
import {
	createFromBody,
	checkCollection,
	editorOf,
	itemNotFound,
	writtenItem
} from "../../helpers/editor-actions.ts";
import { runBulkAction } from "../../helpers/editor-bulk.ts";
import * as editorContent from "../../managers/editor-content.ts";
import type { ContentTypeName } from "../../managers/editor-content.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { revalidateEveryTime } from "../../middleware/cache-control.ts";
import { listQueryFor, parseUpdate } from "../../api/editor-requests.ts";
import { idParams } from "../../api/query-schemas.ts";
import {
	EDITOR_ITEM_SCHEMAS,
	EDITOR_SUMMARY_SCHEMAS,
	editorPage,
	parseResponse
} from "../../api/response-schemas.ts";
import {
	createOptions,
	startingRevisionQuery
} from "../../api/write-schemas.ts";

export function editorItemsRouter(typeName: ContentTypeName): Router {
	const router = express.Router();
	const itemSchema = EDITOR_ITEM_SCHEMAS[typeName];
	const pageSchema = editorPage(EDITOR_SUMMARY_SCHEMAS[typeName]);
	const listQuery = listQueryFor(typeName);
	router.use(revalidateEveryTime);

	router.get("/", async (req, res) => {
		const { in: searchIn, ...filters } = listQuery.parse(req.query);

		const page = await editorContent.listItems(typeName, {
			...filters,
			searchIn
		});
		res.json(parseResponse(pageSchema, page));
	});

	router.get("/:id", async (req, res) => {
		const { id } = idParams.parse(req.params);

		const item = await editorContent.getItem(typeName, id);
		if (!item) {
			throw itemNotFound(typeName, id);
		}
		res.json(parseResponse(itemSchema, item));
	});

	// One response for every item, once all are processed (each item was sent
	// through its response schema there). Before `/:id`, which has no POST.
	router.post("/bulk", async (req, res) => {
		let outcome: Awaited<ReturnType<typeof runBulkAction>>;
		try {
			outcome = await runBulkAction(typeName, req.body, editorOf(res));
		} catch (error) {
			// Refusing the whole request writes nothing; anything else may have
			// failed after some items were written.
			if (!(
				error instanceof ZodError || error instanceof BadRequestError
			)) {
				await mongoManager.updateContentVersion();
			}
			throw error;
		}
		if (outcome.wrote) {
			await mongoManager.updateContentVersion();
		}
		res.json({ results: outcome.results });
	});

	// 201 with the item, or 200 with the one a repeated createId made. A
	// repeat returns the item already made before checking the body again:
	// the first may have been valid only then (a news date since passed, a
	// collection since deleted). It changes the version too, in case the
	// first stopped before it could.
	router.post("/", async (req, res) => {
		const { createId } = createOptions.parse(req.body);
		const result =
			(await editorContent.findCreated(typeName, createId)) ??
			(await createFromBody(typeName, req.body, editorOf(res)));

		const item = writtenItem(typeName, createId, result);
		await mongoManager.updateContentVersion();
		res.status(result.outcome === "ok" && result.created ? 201 : 200).json(
			item
		);
	});

	router.patch("/:id", async (req, res) => {
		const { id } = idParams.parse(req.params);
		const { startingRevision, fields, changesFor } = parseUpdate(
			typeName,
			req.body,
			new Date()
		);
		await checkCollection(typeName, fields);

		const result = await editorContent.updateItem(
			typeName,
			id,
			startingRevision,
			changesFor,
			editorOf(res)
		);
		const item = writtenItem(typeName, id, result);
		await mongoManager.updateContentVersion();
		res.json(item);
	});

	router.delete("/:id", async (req, res) => {
		const { id } = idParams.parse(req.params);
		const { startingRevision } = startingRevisionQuery.parse(req.query);

		writtenItem(
			typeName,
			id,
			await editorContent.deleteItem(typeName, id, startingRevision)
		);
		await mongoManager.updateContentVersion();
		res.sendStatus(204);
	});

	return router;
}
