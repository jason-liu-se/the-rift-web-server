import express, { type Router } from "express";
import { finishLogin, startLogin } from "../auth/discord-login.ts";
import { clearSessionCookie } from "../auth/session-cookie.ts";
import type { AppConfig } from "../config/env.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import { parseResponse, sessionUser } from "./response-schemas.ts";

export function authRouter(config: AppConfig): Router {
	const router = express.Router();

	// The website links here (a navigation, not a fetch) to start a login.
	router.get("/discord", (_req, res) => {
		startLogin(res, config);
	});

	// Discord redirects here; this redirects on to the website either way.
	router.get("/discord/callback", async (req, res) => {
		await finishLogin(req, res, config);
	});

	// The logged-in user, so the website can tell whether someone is logged in.
	router.get("/me", (_req, res) => {
		const { user } = res.locals;
		if (!user) {
			throw new UnauthorizedError();
		}
		res.json(parseResponse(sessionUser, user));
	});

	// Idempotent: logging out without a session still succeeds.
	router.post("/logout", (_req, res) => {
		clearSessionCookie(res, config);
		res.sendStatus(204);
	});

	return router;
}
