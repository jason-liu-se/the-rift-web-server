import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { paginationQuery } from "./query-schemas.ts";

export const newsRouter = express.Router();

// A page of news items, newest first, with the total for paginating.
newsRouter.get("/", async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);

	const [items, total] = await Promise.all([
		mongoManager.getNewsItems(startIndex, limit),
		mongoManager.countNewsItems()
	]);
	res.json({ items, total });
});

// Just the total, for callers that don't need any items.
newsRouter.get("/count", async (req, res) => {
	res.json({ total: await mongoManager.countNewsItems() });
});
