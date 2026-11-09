const express = require("express");
const dotenv = require("dotenv");
const mongoManager = require("../helpers/mongo-manager.js");

const newsRouter = express.Router();

dotenv.config();

newsRouter.get("/get-items", async (req, res) => {
	const startIndex = req.query.startIndex ? req.query.startIndex : 0;
	const limit = req.query.limit ? req.query.limit : -1;

	const data = await mongoManager.getNewsItems(startIndex, limit);
	res.send(data);
});

newsRouter.get("/count-items", async (req, res) => {
	const data = await mongoManager.countNewsItems();
	res.send({ count: data });
});

module.exports = newsRouter;
