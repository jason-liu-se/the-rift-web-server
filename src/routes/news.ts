import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";

export const newsRouter = express.Router();

newsRouter.get("/get-items", async (req, res) => {
	const startIndex = Number(req.query["startIndex"] || 0);
	const limit = Number(req.query["limit"] || -1);

	const data = await mongoManager.getNewsItems(startIndex, limit);
	res.send(data);
});

newsRouter.get("/count-items", async (req, res) => {
	const data = await mongoManager.countNewsItems();
	res.send({ count: data });
});
