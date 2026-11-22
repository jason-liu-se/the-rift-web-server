import express from "express";
import { NotFoundError } from "../../errors/not-found-error.ts";
import { cacheByContentVersion } from "../../middleware/cache-control.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { collectionParams } from "../../api/query-schemas.ts";
import {
	downloadCollections,
	downloadItems,
	parseResponse
} from "../../api/response-schemas.ts";

export const downloadsRouter = express.Router();

// Every visible download collection with its public items, sorted by slug.
downloadsRouter.get("/", cacheByContentVersion, async (req, res) => {
	res.json(
		parseResponse(
			downloadCollections,
			await mongoManager.getPublicDownloadCollections()
		)
	);
});

downloadsRouter.get("/:collection", cacheByContentVersion, async (req, res) => {
	const { collection } = collectionParams.parse(req.params);

	// A hidden collection is the same 404 as a missing one.
	if (!(await mongoManager.hasPublicDownloadCollection(collection))) {
		throw new NotFoundError(`download collection '${collection}'`);
	}

	res.json(
		parseResponse(
			downloadItems,
			await mongoManager.getPublicDownloadItems(collection)
		)
	);
});
