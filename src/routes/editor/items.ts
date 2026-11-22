// A content type's items in the editor tools (/editor/news,
// /editor/gallery/images, ...; every one needs a login). One router per type,
// built from the same pieces: what differs per type lives in CONTENT_TYPES
// (src/managers/editor-content.ts).
import express, { type Router } from "express";
import { itemNotFound } from "../../helpers/editor-actions.ts";
import * as editorContent from "../../managers/editor-content.ts";
import type { ContentTypeName } from "../../managers/editor-content.ts";
import { revalidateEveryTime } from "../../middleware/cache-control.ts";
import { listQueryFor } from "../../api/editor-requests.ts";
import { idParams } from "../../api/query-schemas.ts";
import {
	EDITOR_ITEM_SCHEMAS,
	EDITOR_SUMMARY_SCHEMAS,
	editorPage,
	parseResponse
} from "../../api/response-schemas.ts";

// A type's items: GET / (filtered, searched, and paginated) and GET /:id.
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

	return router;
}
