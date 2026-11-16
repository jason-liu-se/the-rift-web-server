// The API's three rate limiters. Each keeps its own counts, so none uses up
// another's budget (a request may count in two). Counts are per app
// instance, in memory. Settings: src/config/rate-limits.ts.
import type { Request, RequestHandler, Response } from "express";
import { type Options, ipKeyGenerator, rateLimit } from "express-rate-limit";
import { redirectToLoginPage } from "../auth/discord-login.ts";
import { LOGIN_CALLBACK_PATH } from "../config/auth.ts";
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

function tooManyRequests(res: Response, statusCode: number): void {
	res.status(statusCode).json({
		error: "ERROR: too many requests; try again later"
	});
}

// What every limiter shares: standard RateLimit headers and a JSON 429.
function limiter(options: Partial<Options>): RequestHandler {
	return rateLimit({
		standardHeaders: "draft-8",
		legacyHeaders: false,
		handler: (_req, res, _next, { statusCode }) => {
			tooManyRequests(res, statusCode);
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

// Auth limiter: slows down login abuse, refresh-token guessing, and logged-out
// probing. Counts every /auth/* request and every logged-out request to a
// private (or unknown) path, in one budget per client IP, since those callers
// usually aren't logged in. createApp mounts the one instance for both. A
// browser coming back from Discord is redirected to the login page instead,
// like any other failed login.
export function authRateLimit(config: AppConfig): RequestHandler {
	return limiter({
		windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
		limit: AUTH_RATE_LIMIT,
		keyGenerator: (req) => clientIp(req, config),
		handler: (req, res, _next, options) => {
			if (`${req.baseUrl}${req.path}` === `/auth${LOGIN_CALLBACK_PATH}`) {
				redirectToLoginPage(res, config, "rate-limited");
				return;
			}
			tooManyRequests(res, options.statusCode);
		}
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
// request (not GET, HEAD, or OPTIONS) that gets past the login gate: an
// editor's private writes and anyone's public ones (/auth/refresh,
// /auth/logout). Keyed by userOrClientKey.
export function writeRateLimit(config: AppConfig): RequestHandler {
	return limiter({
		windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
		limit: WRITE_RATE_LIMIT,
		skip: (req) => isSafeMethod(req.method),
		keyGenerator: (req, res) => userOrClientKey(req, res, config)
	});
}

// Read limiter: caps how fast anyone can read, e.g. scraping. Counts GET and
// HEAD requests that get past the login gate (public reads and an editor's
// private ones), except /auth/*, which the auth limiter already counts.
// Keyed by userOrClientKey, so behind the Cloudflare Tunnel the website's
// server rendering counts against each visitor, not one shared budget.
export function readRateLimit(config: AppConfig): RequestHandler {
	return limiter({
		windowMs: READ_RATE_LIMIT_WINDOW_MS,
		limit: READ_RATE_LIMIT,
		skip: (req) => !isSafeMethod(req.method) || isAuthPath(req.path),
		keyGenerator: (req, res) => userOrClientKey(req, res, config)
	});
}

function isAuthPath(path: string): boolean {
	return path === "/auth" || path.startsWith("/auth/");
}
