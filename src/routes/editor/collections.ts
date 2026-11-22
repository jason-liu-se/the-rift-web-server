// A type's collections in the editor tools (/editor/gallery/collections,
// /editor/downloads/collections; every one needs a login).
import express, { type Router } from "express";
import * as editorContent from "../../managers/editor-content.ts";
import type { CollectionTypeName } from "../../managers/editor-content.ts";
import { revalidateEveryTime } from "../../middleware/cache-control.ts";
import {
	editorCollections,
	parseResponse
} from "../../api/response-schemas.ts";

// A type's collections: GET / lists every one with its item count.
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

	return router;
}
