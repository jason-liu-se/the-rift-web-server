import express, { type Request, type Router } from "express";
import { rateLimit } from "express-rate-limit";
import { finishLogin, startLogin } from "../auth/discord-login.ts";
import { endSession, refreshSession } from "../auth/refresh-tokens.ts";
import {
	REFRESH_COOKIE,
	clearSessionCookies,
	setSessionCookies
} from "../auth/session-cookie.ts";
import type { AppConfig } from "../config/env.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import { parseResponse, sessionUser } from "./response-schemas.ts";

/** The window auth rate limits are counted over, in milliseconds. */
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
/** Requests to /auth/* each client IP may make per window. */
const AUTH_RATE_LIMIT = 100;

export function authRouter(config: AppConfig): Router {
	const router = express.Router();

	// Auth responses are per user: never cache them.
	router.use((_req, res, next) => {
		res.set("Cache-Control", "no-store");
		next();
	});

	// Slows down login abuse and token guessing; counts are per app instance,
	// in memory.
	router.use(
		rateLimit({
			windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
			limit: AUTH_RATE_LIMIT,
			standardHeaders: "draft-8",
			legacyHeaders: false,
			message: { error: "ERROR: too many requests; try again later" }
		})
	);

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

	// Trades the refresh token for a new access token and a new refresh token
	// (the old one can't be used again), while the session lasts. A reused
	// token ends its session (src/auth/refresh-tokens.ts).
	router.post("/refresh", async (req, res) => {
		const refreshToken = refreshTokenCookie(req);
		const refreshed = refreshToken && (await refreshSession(refreshToken));
		if (!refreshed) {
			clearSessionCookies(res, config);
			throw new UnauthorizedError();
		}

		await setSessionCookies(
			res,
			refreshed.session,
			refreshed.refreshToken,
			config
		);
		res.sendStatus(204);
	});

	// Ends this session only; the user's other sessions go on. Idempotent:
	// logging out without a session still succeeds.
	router.post("/logout", async (req, res) => {
		const refreshToken = refreshTokenCookie(req);
		if (refreshToken) {
			await endSession(refreshToken);
		}
		clearSessionCookies(res, config);
		res.sendStatus(204);
	});

	return router;
}

function refreshTokenCookie(req: Request): string | undefined {
	const token: unknown = req.cookies[REFRESH_COOKIE];
	return typeof token === "string" && token !== "" ? token : undefined;
}
