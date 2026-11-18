import express from "express";

export const healthRouter = express.Router();

// Liveness check for uptime pings (e.g. keeping the host from idling). Never
// cached (the app-wide default), or a ping could be answered without reaching
// the server.
healthRouter.get("/", (_req, res) => {
	res.status(200).end();
});
