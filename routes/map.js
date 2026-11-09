const express = require("express");

const path = require("path");
const mapRouter = express.Router();

mapRouter.use(express.static(path.join(__dirname, "../output map test")));

mapRouter.get("/test", (req, res) => {
	res.sendFile(path.join(__dirname, "../output map test/index.html"));
});

module.exports = mapRouter;
