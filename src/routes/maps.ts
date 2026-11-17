import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { mapSeasons, parseResponse } from "../api/response-schemas.ts";

export const mapsRouter = express.Router();

// Every season's map, oldest season first.
mapsRouter.get("/seasons", async (req, res) => {
	res.json(parseResponse(mapSeasons, await mongoManager.getMapSeasons()));
});
