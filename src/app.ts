// Builds the Express app without connecting to MongoDB or listening, so tests
// can drive it with Supertest. index.ts does both to run the real server.
import express from "express";
import { newsRouter } from "./routes/news.ts";
import { downloadsRouter } from "./routes/downloads.ts";
import { galleryRouter } from "./routes/gallery.ts";

export const app = express();

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
app.use("/news", newsRouter);
app.use("/downloads", downloadsRouter);
app.use("/gallery", galleryRouter);
