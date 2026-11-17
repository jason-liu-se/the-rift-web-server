import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { paginationQuery } from "../api/query-schemas.ts";
import {
	countResponse,
	newsPage,
	parseResponse
} from "../api/response-schemas.ts";

export const newsRouter = express.Router();

// A page of posts, newest first, with the total for paginating.
newsRouter.get("/", async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);

	const [items, total] = await Promise.all([
		mongoManager.getPosts(startIndex, limit),
		mongoManager.countPosts()
	]);
	res.json(parseResponse(newsPage, { items, total }));
});

// Just the total, for callers that don't need any items.
newsRouter.get("/count", async (req, res) => {
	res.json(
		parseResponse(countResponse, {
			total: await mongoManager.countPosts()
		})
	);
});
