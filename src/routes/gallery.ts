import express from "express";
import * as mongoManager from "../helpers/mongo-manager.ts";

export const galleryRouter = express.Router();

galleryRouter.get("/get-collection", async (req, res) => {
	const collectionName =
		typeof req.query["collection"] === "string"
			? req.query["collection"]
			: "";
	const startIndex = Number(req.query["startIndex"] || 0);
	const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;

	if (collectionName === "") {
		res.send({
			error: "ERROR: a collection name has not been passed with the endpoint call"
		});
	} else {
		const data = await mongoManager.getGalleryCollection(
			collectionName,
			startIndex,
			limit
		);
		res.send(data);
	}
});

galleryRouter.get("/count-collection-items", async (req, res) => {
	const collectionName =
		typeof req.query["collection"] === "string"
			? req.query["collection"]
			: "";

	if (collectionName === "") {
		res.send({
			error: "ERROR: a collection name has not been passed with the endpoint call"
		});
	} else {
		const data =
			await mongoManager.countGalleryCollectionItems(collectionName);
		res.send({ count: data });
	}
});
