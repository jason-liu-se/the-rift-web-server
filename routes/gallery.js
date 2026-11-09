const express = require("express");
const dotenv = require("dotenv");
const mongoManager = require("../helpers/mongo-manager.js");

const galleryRouter = express.Router();

dotenv.config();

galleryRouter.get("/get-collection", async (req, res) => {
	const collectionName = req.query.collection ? req.query.collection : "";
	const startIndex = req.query.startIndex ? req.query.startIndex : 0;
	const limit = req.query.limit ? req.query.limit : -1;

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
	const collectionName = req.query.collection ? req.query.collection : "";

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

module.exports = galleryRouter;
