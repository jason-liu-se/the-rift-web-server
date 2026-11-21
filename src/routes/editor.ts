// The editor tools' routes, under /editor (every one needs a login). One
// router per content type's items, and one per gallery or download
// collections, all built from the same pieces: what differs per type lives in
// CONTENT_TYPES (src/managers/editor-content.ts).
import express, { type Response, type Router } from "express";
import type * as z from "zod";
import { NotFoundError } from "../errors/not-found-error.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import * as editorContent from "../managers/editor-content.ts";
import type {
	CollectionTypeName,
	ContentTypeName
} from "../managers/editor-content.ts";
import { revalidateEveryTime } from "../middleware/cache-control.ts";
import { editorListQuery, idParams } from "../api/query-schemas.ts";
import {
	editorCollections,
	editorDownloadItem,
	editorDownloadItemSummary,
	editorGalleryImage,
	editorMapSeason,
	editorMapSeasonSummary,
	editorNewsPost,
	editorNewsPostSummary,
	editorPage,
	parseResponse
} from "../api/response-schemas.ts";

const ITEM_SCHEMAS: Readonly<Record<ContentTypeName, z.ZodType>> = {
	news: editorNewsPost,
	gallery: editorGalleryImage,
	downloads: editorDownloadItem,
	maps: editorMapSeason
};

// What each type's list sends of an item.
const SUMMARY_SCHEMAS: Readonly<Record<ContentTypeName, z.ZodType>> = {
	news: editorNewsPostSummary,
	gallery: editorGalleryImage,
	downloads: editorDownloadItemSummary,
	maps: editorMapSeasonSummary
};

// What each type's item is called in messages.
const ITEM_NAMES: Readonly<Record<ContentTypeName, string>> = {
	news: "news post",
	gallery: "gallery image",
	downloads: "download item",
	maps: "map season"
};

function listQuery(typeName: ContentTypeName) {
	const { statuses, searchFields, collectionModel } =
		editorContent.CONTENT_TYPES[typeName];
	const schema = editorListQuery(statuses, Object.keys(searchFields));
	return collectionModel ? schema : schema.omit({ collection: true });
}

// The logged-in editor's ID. requireLogin makes sure there is one; throwing
// keeps an ownership filter from ever silently matching everyone.
function currentEditorId(res: Response): string {
	const id = res.locals.user?.id;
	if (id === undefined) {
		throw new UnauthorizedError();
	}
	return id;
}

// A type's items: GET / (filtered, searched, and paginated) and GET /:id.
export function editorItemsRouter(typeName: ContentTypeName): Router {
	const router = express.Router();
	const itemSchema = ITEM_SCHEMAS[typeName];
	const pageSchema = editorPage(SUMMARY_SCHEMAS[typeName]);
	const query = listQuery(typeName);
	router.use(revalidateEveryTime);

	router.get("/", async (req, res) => {
		const { mine, in: searchIn, ...filters } = query.parse(req.query);

		const page = await editorContent.listItems(typeName, {
			...filters,
			createdBy: mine ? currentEditorId(res) : undefined,
			searchIn
		});
		res.json(parseResponse(pageSchema, page));
	});

	router.get("/:id", async (req, res) => {
		const { id } = idParams.parse(req.params);

		const item = await editorContent.getItem(typeName, id);
		if (!item) {
			throw new NotFoundError(`${ITEM_NAMES[typeName]} '${id}'`);
		}
		res.json(parseResponse(itemSchema, item));
	});

	return router;
}

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
