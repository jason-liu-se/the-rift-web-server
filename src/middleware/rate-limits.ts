// The API's two rate limiters. Each keeps its own counts, so neither uses up
// the other's budget (a request may count in both). Counts are per app
// instance, in memory. Settings: src/config/rate-limits.ts.
import type { Request, RequestHandler, Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { redirectToLoginPage } from "../auth/discord-login.ts";
import { LOGIN_CALLBACK_PATH } from "../config/auth.ts";
import type { AppConfig } from "../config/env.ts";
import {
	AUTH_RATE_LIMIT,
	AUTH_RATE_LIMIT_WINDOW_MS,
	WRITE_RATE_LIMIT,
	WRITE_RATE_LIMIT_WINDOW_MS
} from "../config/rate-limits.ts";
import { isSafeMethod } from "./http-methods.ts";

function tooManyRequests(res: Response, statusCode: number): void {
	res.status(statusCode).json({
		error: "ERROR: too many requests; try again later"
	});
}

// req.ip relies on TRUST_PROXY_HOPS; IPv6 is keyed by /56 subnet.
function clientIp(req: Request): string {
	return ipKeyGenerator(req.ip ?? "");
}

// Auth limiter: slows down login abuse, refresh-token guessing, and logged-out
// probing. Counts every /auth/* request and every logged-out request to a
// private (or unknown) path, in one budget per client IP, since those callers
// usually aren't logged in. createApp mounts the one instance for both. A
// browser coming back from Discord is redirected to the login page instead,
// like any other failed login.
export function authRateLimit(config: AppConfig): RequestHandler {
	return rateLimit({
		windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
		limit: AUTH_RATE_LIMIT,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		handler: (req, res, _next, options) => {
			if (`${req.baseUrl}${req.path}` === `/auth${LOGIN_CALLBACK_PATH}`) {
				redirectToLoginPage(res, config, "rate-limited");
				return;
			}
			tooManyRequests(res, options.statusCode);
		}
	});
}

// Write limiter: caps how fast anyone can change things. Counts every unsafe
// request (not GET, HEAD, or OPTIONS) that gets past the login gate: an
// editor's private writes and anyone's public ones (/auth/refresh,
// /auth/logout). Keyed by the logged-in user's ID, so editors sharing an IP
// don't share a budget, or else by client IP.
export function writeRateLimit(): RequestHandler {
	return rateLimit({
		windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
		limit: WRITE_RATE_LIMIT,
		standardHeaders: "draft-8",
		legacyHeaders: false,
		skip: (req) => isSafeMethod(req.method),
		keyGenerator: (req, res) =>
			res.locals.user
				? `user:${res.locals.user.id}`
				: `ip:${clientIp(req)}`,
		handler: (_req, res, _next, options) => {
			tooManyRequests(res, options.statusCode);
		}
	});
}
