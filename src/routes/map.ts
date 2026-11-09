import express from "express";
import path from "node:path";

// Resolves to the repository root from both src/routes/ and dist/routes/.
const MAP_DIRECTORY = path.join(import.meta.dirname, "../../output map test");

export const mapRouter = express.Router();

mapRouter.use(express.static(MAP_DIRECTORY));

mapRouter.get("/test", (req, res) => {
	res.sendFile(path.join(MAP_DIRECTORY, "index.html"));
});
