// The httpOnly cookie that carries the session token. SameSite=Lax relies on
// the API and the website being on the same site (README "Sessions and
// access"); it also keeps the cookie off cross-site POSTs.
import type { CookieOptions, Response } from "express";
import type { AppConfig } from "../config/env.ts";
import { SESSION_MAX_AGE_MS, signSession, type Session } from "./session.ts";

export const SESSION_COOKIE = "session";

// For every cookie the API sets.
export function baseCookieOptions(config: AppConfig): CookieOptions {
	return {
		httpOnly: true,
		sameSite: "lax",
		// Browsers refuse Secure cookies over plain http, except on localhost
		// in some browsers; local development runs over http.
		secure: config.FRONTEND_URL.startsWith("https:")
	};
}

function cookieOptions(config: AppConfig): CookieOptions {
	return { ...baseCookieOptions(config), path: "/" };
}

// The cookie expires when the session does, not when the token does: an
// expired token is re-issued while the session lasts.
export async function setSessionCookie(
	res: Response,
	session: Session,
	config: AppConfig
): Promise<void> {
	const token = await signSession(session, config.JWT_SECRET);
	res.cookie(SESSION_COOKIE, token, {
		...cookieOptions(config),
		maxAge: session.loginAt + SESSION_MAX_AGE_MS - Date.now()
	});
}

// Browsers only delete a cookie when the options match the ones it was set with.
export function clearSessionCookie(res: Response, config: AppConfig): void {
	res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}
