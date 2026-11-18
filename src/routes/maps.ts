import express from "express";
import { STATIC_CONTENT_CACHE } from "../config/caching.ts";
import { cacheFor } from "../middleware/cache-control.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { mapSeasons, parseResponse } from "../api/response-schemas.ts";

export const mapsRouter = express.Router();

// Every season's map, oldest season first.
mapsRouter.get("/seasons", cacheFor(STATIC_CONTENT_CACHE), async (req, res) => {
	res.json(parseResponse(mapSeasons, await mongoManager.getMapSeasons()));
});
