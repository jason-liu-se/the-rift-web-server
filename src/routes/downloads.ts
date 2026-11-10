import express from "express";
import { NotFoundError } from "../errors/not-found-error.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { collectionParams } from "./query-schemas.ts";
import {
	downloadCollections,
	downloadItems,
	parseResponse
} from "./response-schemas.ts";

export const downloadsRouter = express.Router();

// Every download collection with its items, sorted by collection name.
downloadsRouter.get("/", async (req, res) => {
	res.json(
		parseResponse(
			downloadCollections,
			await mongoManager.getAllDownloadCollections()
		)
	);
});

downloadsRouter.get("/:collection", async (req, res) => {
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
