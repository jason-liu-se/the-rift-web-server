// The API's two rate limiters. They count different traffic with different
// keys, so neither uses up the other's budget. Counts are per app instance, in
// memory. Settings: src/config/rate-limits.ts.
import type { RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { redirectToLoginPage } from "../auth/discord-login.ts";
import { LOGIN_CALLBACK_PATH } from "../config/auth.ts";
import type { AppConfig } from "../config/env.ts";
import {
	AUTH_RATE_LIMIT,
	AUTH_RATE_LIMIT_WINDOW_MS,
	WRITE_RATE_LIMIT,
	WRITE_RATE_LIMIT_WINDOW_MS
} from "../config/rate-limits.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import { isSafeMethod } from "./http-methods.ts";

function tooManyRequests(res: Response, statusCode: number): void {
	res.status(statusCode).json({
		error: "ERROR: too many requests; try again later"
	});
}

// Auth limiter: slows down login abuse and refresh-token guessing. Counts
// every /auth/* request, keyed by client IP (req.ip, so it relies on
// TRUST_PROXY_HOPS; IPv6 by /56 subnet), since those callers usually aren't
// logged in. Mounted in authRouter. A browser coming back from Discord is
// redirected to the login page instead, like any other failed login.
export function authRateLimit(config: AppConfig): RequestHandler {
	return rateLimit({
		windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
		limit: AUTH_RATE_LIMIT,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		handler: (req, res, _next, options) => {
			if (req.path === LOGIN_CALLBACK_PATH) {
				redirectToLoginPage(res, config, "rate-limited");
				return;
			}
			tooManyRequests(res, options.statusCode);
		}
	});
}

// Write limiter: caps how fast one editor (or a stolen session) can change
// content. Counts private, unsafe requests (not GET, HEAD, or OPTIONS), keyed
// by the logged-in user's ID, so editors sharing an IP don't share a budget.
// Mounted in requireLogin after the login check, so public routes (all of
// /auth) and reads (server rendering) never reach it.
export function writeRateLimit(): RequestHandler {
	return rateLimit({
		windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
		limit: WRITE_RATE_LIMIT,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		skip: (req) => isSafeMethod(req.method),
		keyGenerator: (_req, res) => {
			// requireLogin has already checked; never fall back to a shared key.
			if (!res.locals.user) {
				throw new UnauthorizedError();
			}
			return res.locals.user.id;
		},
		handler: (_req, res, _next, options) => {
			tooManyRequests(res, options.statusCode);
		}
	});
}
