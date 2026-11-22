import express from "express";
import { cacheByContentVersion } from "../../middleware/cache-control.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { mapSeasons, parseResponse } from "../../api/response-schemas.ts";

export const mapsRouter = express.Router();

// Every season's map, oldest season first.
mapsRouter.get("/seasons", cacheByContentVersion, async (req, res) => {
	res.json(parseResponse(mapSeasons, await mongoManager.getMapSeasons()));
});
