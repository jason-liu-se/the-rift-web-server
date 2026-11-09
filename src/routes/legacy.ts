// Deprecated verb-style endpoints, kept until the website switches to the
// RESTful routes. Mounted before those routers so a path like
// `/gallery/get-collection` isn't read as a collection named "get-collection".
// Remove this file and its `app.use` once nothing calls these paths.
import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import {
	collectionQuery,
	paginatedCollectionQuery,
	paginationQuery
} from "./query-schemas.ts";

export const legacyRouter = express.Router();

legacyRouter.get("/news/get-items", async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);

	res.json(await mongoManager.getNewsItems(startIndex, limit));
});

legacyRouter.get("/news/count-items", async (req, res) => {
	res.json({ count: await mongoManager.countNewsItems() });
});

legacyRouter.get("/gallery/get-collection", async (req, res) => {
	const { collection, startIndex, limit } = paginatedCollectionQuery.parse(
		req.query
	);

	res.json(
		await mongoManager.getGalleryCollection(collection, startIndex, limit)
	);
});

legacyRouter.get("/gallery/count-collection-items", async (req, res) => {
	const { collection } = collectionQuery.parse(req.query);

	res.json({
		count: await mongoManager.countGalleryCollectionItems(collection)
	});
});

legacyRouter.get("/downloads/get-collection", async (req, res) => {
	const { collection } = collectionQuery.parse(req.query);

	res.json(await mongoManager.getDownloadCollection(collection));
});

legacyRouter.get("/downloads/get-all", async (req, res) => {
	res.json(await mongoManager.getAllDownloadCollections());
});
