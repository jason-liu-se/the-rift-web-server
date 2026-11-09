const express = require("express");
const mapRouter = require("./routes/map");
const newsRouter = require("./routes/news");
const downloadsRouter = require("./routes/downloads");
const galleryRouter = require("./routes/gallery");
const mongoManger = require("./helpers/mongo-manager.js");

const app = express();
const port = process.env.PORT || 4000;

mongoManger.connect();

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

app.listen(port, (error) => {
	// Express 5 passes startup errors (e.g. port in use) here instead of throwing.
	if (error) {
		throw error;
	}

	console.log(`Listening on port ${port}`);
});
