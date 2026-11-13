// The httpOnly cookies that carry a session: the access token, sent with every
// request, and the refresh token, sent only to /auth (where /auth/refresh and
// /auth/logout read it). SameSite=Lax relies on the API and the website being
// on the same site (README "Sessions and access"); it also keeps the cookies
// off cross-site POSTs.
import type { CookieOptions, Response } from "express";
import type { AppConfig } from "../config/env.ts";
import { sessionEndsAt, signSession, type Session } from "./session.ts";

export const SESSION_COOKIE = "session";
export const REFRESH_COOKIE = "refresh_token";

const REFRESH_COOKIE_PATH = "/auth";

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

function sessionCookieOptions(config: AppConfig): CookieOptions {
	return { ...baseCookieOptions(config), path: "/" };
}

function refreshCookieOptions(config: AppConfig): CookieOptions {
	return { ...baseCookieOptions(config), path: REFRESH_COOKIE_PATH };
}

// Each cookie expires with what it holds: the access cookie with its token,
// the refresh cookie with the session.
export async function setSessionCookies(
	res: Response,
	session: Session,
	refreshToken: string,
	config: AppConfig
): Promise<void> {
	const { token, expiresAt } = await signSession(session, config.JWT_SECRET);
	const now = Date.now();

	res.cookie(SESSION_COOKIE, token, {
		...sessionCookieOptions(config),
		maxAge: expiresAt - now
	});
	res.cookie(REFRESH_COOKIE, refreshToken, {
		...refreshCookieOptions(config),
		maxAge: sessionEndsAt(session.loginAt) - now
	});
}

// Browsers only delete a cookie when the options match the ones it was set with.
export function clearAccessCookie(res: Response, config: AppConfig): void {
	res.clearCookie(SESSION_COOKIE, sessionCookieOptions(config));
}

export function clearSessionCookies(res: Response, config: AppConfig): void {
	clearAccessCookie(res, config);
	res.clearCookie(REFRESH_COOKIE, refreshCookieOptions(config));
}
