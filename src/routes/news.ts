import express from "express";
import { cacheByContentVersion } from "../middleware/cache-control.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { paginationQuery } from "../api/query-schemas.ts";
import {
	countResponse,
	newsPostsPage,
	parseResponse
} from "../api/response-schemas.ts";

export const newsRouter = express.Router();

// A page of news posts, newest first, with the total for paginating.
newsRouter.get("/", cacheByContentVersion, async (req, res) => {
	const { startIndex, limit } = paginationQuery.parse(req.query);

	const [items, total] = await Promise.all([
		mongoManager.getNewsPosts(startIndex, limit),
		mongoManager.countNewsPosts()
	]);
	res.json(parseResponse(newsPostsPage, { items, total }));
});

// Just the total, for callers that don't need any items.
newsRouter.get("/count", cacheByContentVersion, async (req, res) => {
	res.json(
		parseResponse(countResponse, {
			total: await mongoManager.countNewsPosts()
		})
	);
});
