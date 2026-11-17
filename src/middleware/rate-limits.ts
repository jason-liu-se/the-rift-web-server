// The API's three rate limiters. Each keeps its own counts, so none uses up
// another's budget (a request may count in two). Counts are per app
// instance, in memory. Settings: src/config/rate-limits.ts.
import type { Request, RequestHandler, Response } from "express";
import { type Options, ipKeyGenerator, rateLimit } from "express-rate-limit";
import { redirectToLoginPage } from "../auth/discord-login.ts";
import { CURRENT_USER_PATH, LOGIN_CALLBACK_PATH } from "../config/auth.ts";
import type { AppConfig } from "../config/env.ts";
import {
	AUTH_RATE_LIMIT,
	AUTH_RATE_LIMIT_WINDOW_MS,
	READ_RATE_LIMIT,
	READ_RATE_LIMIT_WINDOW_MS,
	WRITE_RATE_LIMIT,
	WRITE_RATE_LIMIT_WINDOW_MS
} from "../config/rate-limits.ts";
import { isSafeMethod } from "./http-methods.ts";

// What every limiter shares: standard RateLimit headers and a JSON 429. A
// browser coming back from Discord is redirected to the login page instead,
// like any other failed login, whichever limiter stopped it.
function limiter(config: AppConfig, options: Partial<Options>): RequestHandler {
	return rateLimit({
		standardHeaders: "draft-8",
		legacyHeaders: false,
		handler: (req, res, _next, { statusCode }) => {
			if (
				routePath(req) === `/auth${LOGIN_CALLBACK_PATH}`.toLowerCase()
			) {
				redirectToLoginPage(res, config, "rate-limited");
				return;
			}
			res.status(statusCode).json({
				error: "ERROR: too many requests; try again later"
			});
		},
		...options
	});
}

// The client's address, IPv6 by /56 subnet. Behind the tunnel every request
// arrives from cloudflared, so Cloudflare's header names the client; for the
// website's server rendering it's the visitor, not the Worker. Requests
// without it (the host's own health checks) can't come through Cloudflare.
// Otherwise req.ip, which relies on TRUST_PROXY_HOPS.
function clientIp(req: Request, config: AppConfig): string {
	const ip = config.BEHIND_CLOUDFLARE_TUNNEL
		? (req.get("CF-Connecting-IP") ?? req.ip)
		: req.ip;
	return ipKeyGenerator(ip ?? "");
}

// Auth limiter: slows down login abuse and refresh-token guessing. Counts
// the login steps and session upkeep (everything under /auth but /auth/me,
// which is only a read), in one budget per client IP, since those callers
// usually aren't logged in. Mounted on /auth, before the login gate, so it
// counts logged-out requests to unknown /auth paths too.
export function authRateLimit(config: AppConfig): RequestHandler {
	return limiter(config, {
		windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
		limit: AUTH_RATE_LIMIT,
		skip: (req) =>
			routePath(req) === `/auth${CURRENT_USER_PATH}`.toLowerCase(),
		keyGenerator: (req) => clientIp(req, config)
	});
}

// The logged-in user, so editors sharing an IP don't share a budget, or else
// the client IP.
function userOrClientKey(
	req: Request,
	res: Response,
	config: AppConfig
): string {
	return res.locals.user
		? `user:${res.locals.user.id}`
		: `ip:${clientIp(req, config)}`;
}

// Write limiter: caps how fast anyone can change things. Counts every unsafe
// request (not GET, HEAD, or OPTIONS), before the login gate: an editor's
// writes, and logged-out ones the gate then refuses. Not /auth/* (refresh,
// logout): the auth limiter counts those, so an editor's writes can't stop
// them refreshing their session or logging out. Keyed by userOrClientKey.
export function writeRateLimit(config: AppConfig): RequestHandler {
	return limiter(config, {
		windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
		limit: WRITE_RATE_LIMIT,
		skip: (req) => isSafeMethod(req.method) || isAuthPath(routePath(req)),
		keyGenerator: (req, res) => userOrClientKey(req, res, config)
	});
}

// Read limiter: caps how fast anyone can read, e.g. scraping. Counts every
// GET and HEAD request, before the login gate: public reads (/auth/* too), an
// editor's private ones, and logged-out ones the gate then refuses. Keyed by
// userOrClientKey, so behind the Cloudflare Tunnel the website's server
// rendering counts against each visitor, not one shared budget. Without the
// tunnel it shares Cloudflare's IPs (or localhost in development), so every
// read gets the higher READ_RATE_LIMIT_WITHOUT_TUNNEL instead.
export function readRateLimit(config: AppConfig): RequestHandler {
	return limiter(config, {
		windowMs: READ_RATE_LIMIT_WINDOW_MS,
		limit: config.BEHIND_CLOUDFLARE_TUNNEL
			? READ_RATE_LIMIT
			: config.READ_RATE_LIMIT_WITHOUT_TUNNEL,
		skip: (req) => !isSafeMethod(req.method),
		keyGenerator: (req, res) => userOrClientKey(req, res, config)
	});
}

function isAuthPath(path: string): boolean {
	return path === "/auth" || path.startsWith("/auth/");
}

// The full path as Express routes it: case-insensitive, with an optional
// trailing slash, so /Auth/discord/callback/ is the callback too.
function routePath(req: Request): string {
	const path = `${req.baseUrl}${req.path}`.toLowerCase();
	return path.length > 1 ? path.replace(/\/$/, "") : path;
}
