import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { contentVersion, parseResponse } from "../api/response-schemas.ts";

export const contentRouter = express.Router();

// The version public reads send as `v` (see cacheFor). Never cached (the
// app-wide default), so a change shows on the caller's next page load.
contentRouter.get("/version", async (_req, res) => {
	res.json(
		parseResponse(contentVersion, {
			version: await mongoManager.getContentVersion()
		})
	);
});
