import express from "express";

export const healthRouter = express.Router();

// Liveness check for uptime pings (e.g. keeping the host from idling)
healthRouter.get("/", (_req, res) => {
	res.status(200).end();
});
