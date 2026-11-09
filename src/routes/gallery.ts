import express from "express";
import { NotFoundError } from "../errors/not-found-error.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { collectionParams, paginationQuery } from "./query-schemas.ts";

export const galleryRouter = express.Router();

// Parses the `:collection` path parameter and checks the collection exists.
async function parseExistingCollection(params: unknown): Promise<string> {
	const { collection } = collectionParams.parse(params);

	if (!(await mongoManager.hasGalleryCollection(collection))) {
		throw new NotFoundError(`gallery collection '${collection}'`);
	}
	return collection;
}

// A page of a gallery collection's images, with the total for paginating.
galleryRouter.get("/:collection", async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);
	const collection = await parseExistingCollection(req.params);

	const [items, total] = await Promise.all([
		mongoManager.getGalleryCollection(collection, startIndex, limit),
		mongoManager.countGalleryCollectionItems(collection)
	]);
	res.json({ items, total });
});

// Just the total, for callers that don't need any images.
galleryRouter.get("/:collection/count", async (req, res) => {
	const collection = await parseExistingCollection(req.params);

	res.json({
		total: await mongoManager.countGalleryCollectionItems(collection)
	});
});
