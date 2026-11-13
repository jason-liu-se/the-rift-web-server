import type { RequestHandler } from "express";
import type { AppConfig } from "../config/env.ts";
import { cookieValue } from "../routes/query-schemas.ts";
import { verifySession } from "./session.ts";
import { SESSION_COOKIE } from "./session-cookie.ts";

// Sets res.locals.user from the access token cookie. Never rejects a request:
// a missing, invalid, or expired token just means nobody is logged in, and the
// website then calls POST /auth/refresh. The cookie is left alone: it expires
// with its token, and /auth/refresh replaces it in the same response.
// Routes that need a user check res.locals.user themselves.
export function sessionMiddleware(config: AppConfig): RequestHandler {
	return async (req, res, next) => {
		const token = cookieValue.parse(req.cookies[SESSION_COOKIE]);
		const user = token && (await verifySession(token, config.JWT_SECRET));
		if (user) {
			res.locals.user = user;
		}
		next();
	};
}
