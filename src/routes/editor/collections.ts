// A type's collections in the editor tools (/editor/gallery/collections,
// /editor/downloads/collections; every one needs a login): list, create,
// update (title, visibility), and delete with every item in it.
import express, { type Router } from "express";
import { editorOf, writtenCollection } from "../../helpers/editor-actions.ts";
import * as editorContent from "../../managers/editor-content.ts";
import type { CollectionTypeName } from "../../managers/editor-content.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { revalidateEveryTime } from "../../middleware/cache-control.ts";
import { slugParams } from "../../api/query-schemas.ts";
import {
	editorCollections,
	parseResponse
} from "../../api/response-schemas.ts";
import {
	collectionCreateRequest,
	collectionUpdateRequest,
	startingRevisionQuery
} from "../../api/write-schemas.ts";

export function editorCollectionsRouter(typeName: CollectionTypeName): Router {
	const router = express.Router();
	router.use(revalidateEveryTime);

	router.get("/", async (_req, res) => {
		res.json(
			parseResponse(
				editorCollections,
				await editorContent.listCollections(typeName)
			)
		);
	});

	router.post("/", async (req, res) => {
		const fields = collectionCreateRequest.parse(req.body);

		const collection = writtenCollection(
			typeName,
			fields.slug,
			await editorContent.createCollection(
				typeName,
				fields,
				editorOf(res)
			)
		);
		await mongoManager.updateContentVersion();
		res.status(201).json(collection);
	});

	router.patch("/:slug", async (req, res) => {
		const { slug } = slugParams.parse(req.params);
		const { startingRevision, ...changes } = collectionUpdateRequest.parse(
			req.body
		);

		const collection = writtenCollection(
			typeName,
			slug,
			await editorContent.updateCollection(
				typeName,
				slug,
				startingRevision,
				changes,
				editorOf(res)
			)
		);
		await mongoManager.updateContentVersion();
		res.json(collection);
	});

	router.delete("/:slug", async (req, res) => {
		const { slug } = slugParams.parse(req.params);
		const { startingRevision } = startingRevisionQuery.parse(req.query);

		writtenCollection(
			typeName,
			slug,
			await editorContent.deleteCollection(
				typeName,
				slug,
				startingRevision
			)
		);
		await mongoManager.updateContentVersion();
		res.sendStatus(204);
	});

	return router;
}
