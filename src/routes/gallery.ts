import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { collectionQuery, paginatedCollectionQuery } from "./query-schemas.ts";

export const galleryRouter = express.Router();

galleryRouter.get("/get-collection", async (req, res) => {
	const { collection, startIndex, limit } = paginatedCollectionQuery.parse(
		req.query
	);

	const data = await mongoManager.getGalleryCollection(
		collection,
		startIndex,
		limit
	);
	res.json(data);
});

galleryRouter.get("/count-collection-items", async (req, res) => {
	const { collection } = collectionQuery.parse(req.query);

	const data = await mongoManager.countGalleryCollectionItems(collection);
	res.json({ count: data });
});
