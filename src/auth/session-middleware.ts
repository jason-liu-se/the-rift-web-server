import type { RequestHandler } from "express";
import type { AppConfig } from "../config/env.ts";
import { isSessionOver, verifySession } from "./session.ts";
import {
	SESSION_COOKIE,
	clearSessionCookie,
	setSessionCookie
} from "./session-cookie.ts";

// Sets res.locals.user from the session cookie, re-issuing an expired token
// while its session lasts. Never rejects a request: a missing, invalid, or
// ended session just means nobody is logged in (and its cookie is cleared).
// Routes that need a user check res.locals.user themselves.
export function sessionMiddleware(config: AppConfig): RequestHandler {
	return async (req, res, next) => {
		const token: unknown = req.cookies[SESSION_COOKIE];
		if (typeof token !== "string") {
			next();
			return;
		}

		const session = await verifySession(token, config.JWT_SECRET);
		if (!session || isSessionOver(session.loginAt)) {
			clearSessionCookie(res, config);
			next();
			return;
		}

		if (session.isTokenExpired) {
			await setSessionCookie(res, session, config);
		}
		res.locals.user = session.user;
		next();
	};
}
