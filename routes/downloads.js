const express = require("express");
const dotenv = require("dotenv");
const mongoManager = require("../helpers/mongo-manager.js");

const downloadsRouter = express.Router();

dotenv.config();

downloadsRouter.get("/get-collection", async (req, res) => {
	const collectionName = req.query.collection ? req.query.collection : "";

	if (collectionName === "") {
		res.send({
			data: [],
			error: "ERROR: a collection name has not been passed with the endpoint call"
		});
	} else {
		const data = await mongoManager.getDownloadCollection(collectionName);
		res.send(data);
	}
});

downloadsRouter.get("/get-all", async (req, res) => {
	const data = await mongoManager.getAllDownloadCollections();
	res.send(data);
});

module.exports = downloadsRouter;
