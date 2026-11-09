// Builds the Express app without connecting to MongoDB or listening, so tests
// can drive it with Supertest. index.js does both to run the real server.
const express = require("express");
const mapRouter = require("./routes/map");
const newsRouter = require("./routes/news");
const downloadsRouter = require("./routes/downloads");
const galleryRouter = require("./routes/gallery");

const app = express();

app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
	res.header("Access-Control-Allow-Headers", "Content-Type");
	if (req.method === "OPTIONS") {
		res.sendStatus(204);
	} else {
		next();
	}
});
app.use("/map", mapRouter);
app.use("/news", newsRouter);
app.use("/downloads", downloadsRouter);
app.use("/gallery", galleryRouter);

module.exports = app;
