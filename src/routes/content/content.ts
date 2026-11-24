import express from "express";
import { detailVersionArea } from "../../helpers/detail-versions.ts";
import { NotFoundError } from "../../errors/not-found-error.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { detailVersionParams } from "../../api/query-schemas.ts";
import {
	contentVersion,
	detailVersion,
	parseResponse
} from "../../api/response-schemas.ts";

export const contentRouter = express.Router();

// The version public reads send as `v` (see cacheByContentVersion). Never
// cached (the app-wide default), so a change shows on the caller's next page
// load.
contentRouter.get("/version", async (_req, res) => {
	res.json(
		parseResponse(contentVersion, {
			version: await mongoManager.getContentVersion()
		})
	);
});

// An area's detail version, which its public reads send as `dv` with `v`.
// Never cached, like the content version.
contentRouter.get("/version/:area", async (req, res) => {
	const { area } = detailVersionParams.parse(req.params);
	const registered = detailVersionArea(area);
	if (!registered) {
		throw new NotFoundError(`detail version area '${area}'`);
	}

	res.json(
		parseResponse(detailVersion, { version: await registered.currentKey() })
	);
});
