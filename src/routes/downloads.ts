import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { collectionQuery } from "./query-schemas.ts";

export const downloadsRouter = express.Router();

downloadsRouter.get("/get-collection", async (req, res) => {
	const { collection } = collectionQuery.parse(req.query);

	const data = await mongoManager.getDownloadCollection(collection);
	res.json(data);
});

downloadsRouter.get("/get-all", async (req, res) => {
	const data = await mongoManager.getAllDownloadCollections();
	res.json(data);
});
