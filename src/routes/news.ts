import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { paginationQuery } from "./query-schemas.ts";

export const newsRouter = express.Router();

newsRouter.get("/get-items", async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);

	const data = await mongoManager.getNewsItems(startIndex, limit);
	res.json(data);
});

newsRouter.get("/count-items", async (req, res) => {
	const data = await mongoManager.countNewsItems();
	res.json({ count: data });
});
