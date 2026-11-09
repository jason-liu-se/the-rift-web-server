import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { paginationQuery } from "./query-schemas.ts";

export const newsRouter = express.Router();

newsRouter.get("/get-items", async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);

	const data = await mongoManager.getNewsItems(startIndex, limit);
	res.send(data);
});

newsRouter.get("/count-items", async (req, res) => {
	const data = await mongoManager.countNewsItems();
	res.send({ count: data });
});
