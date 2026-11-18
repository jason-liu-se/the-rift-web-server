import express from "express";
import { forbidCaching } from "../middleware/cache-control.ts";

export const healthRouter = express.Router();

// Liveness check for uptime pings (e.g. keeping the host from idling). Never
// cached, or a ping could be answered without reaching the server.
healthRouter.get("/", (_req, res) => {
	forbidCaching(res);
	res.status(200).end();
});
