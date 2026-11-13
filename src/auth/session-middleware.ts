import type { RequestHandler } from "express";
import type { AppConfig } from "../config/env.ts";
import { verifySession } from "./session.ts";
import { SESSION_COOKIE, clearAccessCookie } from "./session-cookie.ts";

// Sets res.locals.user from the access token cookie. Never rejects a request:
// a missing, invalid, or expired token just means nobody is logged in (and its
// cookie is cleared); the website then calls POST /auth/refresh. Routes that
// need a user check res.locals.user themselves.
export function sessionMiddleware(config: AppConfig): RequestHandler {
	return async (req, res, next) => {
		const token: unknown = req.cookies[SESSION_COOKIE];
		if (typeof token !== "string") {
			next();
			return;
		}

		const user = await verifySession(token, config.JWT_SECRET);
		if (user) {
			res.locals.user = user;
		} else {
			clearAccessCookie(res, config);
		}
		next();
	};
}
