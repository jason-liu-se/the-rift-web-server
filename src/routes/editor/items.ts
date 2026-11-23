// A content type's items in the editor tools (/editor/news,
// /editor/gallery/images, ...; every one needs a login): list, read, create,
// update, delete, and bulk actions. One router per type, built from the same
// pieces: what differs per type lives in CONTENT_TYPES
// (src/managers/editor-content.ts).
import express, { type Request, type Response, type Router } from "express";
import { ZodError } from "zod";
import { BadRequestError } from "../../errors/bad-request-error.ts";
import {
	editorOf,
	itemNotFound,
	writtenItem
} from "../../helpers/editor-actions.ts";
import {
	type BulkOutcome,
	bulkCreate,
	bulkDelete,
	bulkUpdate,
	createEach,
	deleteEach,
	onlyOutcome,
	updateEach
} from "../../helpers/editor-bulk.ts";
import { BULK_CREATE_REQUESTS } from "../../api/bulk-requests.ts";
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

	// The bulk actions: one response for every item, once all are processed
	// (each item was sent through its response schema there). Before `/:id`.
	// POST only for the types that have a bulk create.
	const bulk =
		(run: (req: Request, res: Response) => Promise<BulkOutcome>) =>
		async (req: Request, res: Response) => {
			let outcome: BulkOutcome;
			try {
				outcome = await run(req, res);
			} catch (error) {
				// Refusing the whole request writes nothing; anything else may
				// have failed after some items were written.
				if (!(
					error instanceof ZodError ||
					error instanceof BadRequestError
				)) {
					await mongoManager.updateContentVersion();
				}
				throw error;
			}
			if (outcome.wrote) {
				await mongoManager.updateContentVersion();
			}
			res.json({ results: outcome.results });
		};
	if (BULK_CREATE_REQUESTS[typeName]) {
		router.post(
			"/bulk",
			bulk((req, res) => bulkCreate(typeName, req.body, editorOf(res)))
		);
	}
	router.patch(
		"/bulk",
		bulk((req, res) => bulkUpdate(typeName, req.body, editorOf(res)))
	);
	router.delete(
		"/bulk",
		bulk((req) => bulkDelete(typeName, req.body))
	);

	// Single writes are bulk writes of one item, answered with a status: 201
	// with the item, or 200 with the one a repeated createId made (see
	// createEach). A repeat changes the version too, in case the first
	// stopped before it could.
	router.post("/", async (req, res) => {
		const body = createOptions.loose().parse(req.body);

		const result = onlyOutcome(
			await createEach(typeName, [body], editorOf(res))
		);
		const item = writtenItem(typeName, body.createId, result);
		await mongoManager.updateContentVersion();
		res.status("created" in result && result.created ? 201 : 200).json(
			item
		);
	});

	router.patch("/:id", async (req, res) => {
		const { id } = idParams.parse(req.params);
		const now = new Date();

		const result = onlyOutcome(
			await updateEach(
				typeName,
				[req.body],
				(body) => {
					const { startingRevision, fields, changesFor } =
						parseUpdate(typeName, body, now);
					return {
						id,
						startingRevision,
						changesFor,
						collection: fields["collection"]
					};
				},
				editorOf(res),
				now
			)
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
			onlyOutcome(await deleteEach(typeName, [{ id, startingRevision }]))
		);
		await mongoManager.updateContentVersion();
		res.sendStatus(204);
	});

	return router;
}
