// The Discord OAuth2 login (authorization code flow). /auth/discord sends the
// browser to Discord with a random `state`, also kept in a short-lived cookie;
// Discord sends it back to /auth/discord/callback, where a matching `state`
// proves the login started here (CSRF protection). The user then needs a
// matching access grant. Discord's access token is dropped after the login.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import type { AppConfig } from "../config/env.ts";
import type { LoginErrorCode } from "../contract/api-responses.ts";
import {
	DiscordApiError,
	discordAuthorizeUrl,
	exchangeCode,
	getIdentity
} from "../helpers/discord.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { cookieValue, discordCallbackQuery } from "../routes/query-schemas.ts";
import { startSession } from "./refresh-tokens.ts";
import { baseCookieOptions, setSessionCookies } from "./session-cookie.ts";

const LOGIN_STATE_COOKIE = "login_state";
/** How long a started login can take to come back from Discord, in ms. */
const LOGIN_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const LOGIN_STATE_BYTES = 32;

const ADMIN_PATH = "/admin";
const LOGIN_PAGE_PATH = "/admin/login";

class LoginRejected extends Error {
	readonly code: LoginErrorCode;

	constructor(code: LoginErrorCode, reason: string) {
		super(reason);
		this.code = code;
	}
}

function stateCookieOptions(config: AppConfig): CookieOptions {
	// Only the callback needs it.
	return { ...baseCookieOptions(config), path: "/auth/discord" };
}

// Redirects to Discord's consent screen.
export function startLogin(res: Response, config: AppConfig): void {
	const state = randomBytes(LOGIN_STATE_BYTES).toString("base64url");

	res.cookie(LOGIN_STATE_COOKIE, state, {
		...stateCookieOptions(config),
		maxAge: LOGIN_STATE_MAX_AGE_MS
	});
	res.redirect(discordAuthorizeUrl(config, state));
}

// Handles Discord's redirect back: logs the user in and redirects to the
// website's admin page, or to its login page with a LoginErrorCode. Logs why a
// login failed, but only the code reaches the browser.
export async function finishLogin(
	req: Request,
	res: Response,
	config: AppConfig
): Promise<void> {
	// One attempt per state, whatever the outcome.
	res.clearCookie(LOGIN_STATE_COOKIE, stateCookieOptions(config));

	try {
		await logIn(req, res, config);
		res.redirect(`${config.FRONTEND_URL}${ADMIN_PATH}`);
	} catch (error) {
		const code = loginErrorCode(error);
		console.error(`Discord login failed (${code}):`, error);
		redirectToLoginPage(res, config, code);
	}
}

// Sends the browser to the website's login page, which shows `code`.
export function redirectToLoginPage(
	res: Response,
	config: AppConfig,
	code: LoginErrorCode
): void {
	res.redirect(
		`${config.FRONTEND_URL}${LOGIN_PAGE_PATH}?${new URLSearchParams({ error: code })}`
	);
}

async function logIn(
	req: Request,
	res: Response,
	config: AppConfig
): Promise<void> {
	const query = discordCallbackQuery.safeParse(req.query);
	if (!query.success) {
		throw new LoginRejected("invalid-request", "malformed callback query");
	}

	// Check the state before trusting anything else in the query, so a request
	// that didn't come back from a login started here can't put its own text
	// in the logs.
	const { code, state, error } = query.data;
	if (!state || !isExpectedState(state, req)) {
		throw new LoginRejected(
			"invalid-request",
			"missing or mismatched state"
		);
	}
	if (error === "access_denied") {
		throw new LoginRejected("access-denied", "the user cancelled");
	}
	if (error) {
		// Any other OAuth2 error means our authorize request was wrong.
		throw new Error(`Discord rejected the authorize request: ${error}`);
	}
	if (!code) {
		throw new LoginRejected("invalid-request", "missing code");
	}

	const accessToken = await exchangeCode(code, config);
	const { user, roleIds } = await getIdentity(
		accessToken,
		config.DISCORD_GUILD_ID
	);

	if (
		!(await mongoManager.hasAccessGrant({
			userId: user.id,
			roleIds
		}))
	) {
		throw new LoginRejected(
			"not-authorized",
			`no access grant for Discord user ${user.id}`
		);
	}

	const session = { user, loginAt: Date.now() };
	await setSessionCookies(res, session, await startSession(session), config);
}

function isExpectedState(state: string, req: Request): boolean {
	const expected = cookieValue.parse(req.cookies[LOGIN_STATE_COOKIE]);
	if (!expected) {
		return false;
	}

	const actualBytes = Buffer.from(state);
	const expectedBytes = Buffer.from(expected);
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

function loginErrorCode(error: unknown): LoginErrorCode {
	if (error instanceof LoginRejected) {
		return error.code;
	}
	if (error instanceof DiscordApiError) {
		return "discord-unavailable";
	}
	return "server-error";
}
