import express from "express";
import { NotFoundError } from "../errors/not-found-error.ts";
import { cacheByContentVersion } from "../middleware/cache-control.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { collectionParams } from "../api/query-schemas.ts";
import {
	downloadCollections,
	downloadItems,
	parseResponse
} from "../api/response-schemas.ts";

export const downloadsRouter = express.Router();

// Every download collection with its items, sorted by collection name.
downloadsRouter.get("/", cacheByContentVersion, async (req, res) => {
	res.json(
		parseResponse(
			downloadCollections,
			await mongoManager.getAllDownloadCollections()
		)
	);
});

downloadsRouter.get("/:collection", cacheByContentVersion, async (req, res) => {
	const { collection } = collectionParams.parse(req.params);

	if (!(await mongoManager.hasDownloadCollection(collection))) {
		throw new NotFoundError(`download collection '${collection}'`);
	}

	res.json(
		parseResponse(
			downloadItems,
			await mongoManager.getDownloadCollection(collection)
		)
	);
});
