// The Discord OAuth2 login (authorization code flow). /auth/discord sends the
// browser to Discord with a random `state`, also kept in a short-lived cookie;
// Discord sends it back to /auth/discord/callback, where a matching `state`
// proves the login started here (CSRF protection). The user then needs a
// matching access grant. Discord's access token is dropped after the login.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import * as z from "zod";
import type { AppConfig } from "../config/env.ts";
import type { LoginErrorCode } from "../contract/api-responses.ts";
import {
	DiscordApiError,
	discordAuthorizeUrl,
	exchangeCode,
	getIdentity
} from "../helpers/discord.ts";
import * as mongoManager from "../helpers/mongo-manager.ts";
import { baseCookieOptions, setSessionCookie } from "./session-cookie.ts";

const LOGIN_STATE_COOKIE = "login_state";
/** How long a started login can take to come back from Discord, in ms. */
const LOGIN_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const LOGIN_STATE_BYTES = 32;

const ADMIN_PATH = "/admin";
const LOGIN_PAGE_PATH = "/admin/login";

// Discord adds `error` (e.g. access_denied) instead of `code` when the user
// cancels or the request was invalid.
const callbackQuery = z.object({
	code: z.string().min(1).optional(),
	state: z.string().min(1).optional(),
	error: z.string().optional()
});

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
		res.redirect(
			`${config.FRONTEND_URL}${LOGIN_PAGE_PATH}?${new URLSearchParams({ error: code })}`
		);
	}
}

async function logIn(
	req: Request,
	res: Response,
	config: AppConfig
): Promise<void> {
	const query = callbackQuery.safeParse(req.query);
	if (!query.success) {
		throw new LoginRejected("invalid-request", "malformed callback query");
	}

	const { code, state, error } = query.data;
	if (error === "access_denied") {
		throw new LoginRejected("access-denied", "the user cancelled");
	}
	if (error) {
		// Any other OAuth2 error means our authorize request was wrong.
		throw new Error(`Discord rejected the authorize request: ${error}`);
	}
	if (!code || !state || !isExpectedState(state, req)) {
		throw new LoginRejected(
			"invalid-request",
			"missing code, or missing or mismatched state"
		);
	}

	const accessToken = await exchangeCode(code, config);
	const { user, roleIds, serverIds } = await getIdentity(
		accessToken,
		config.DISCORD_GUILD_ID
	);

	if (
		!(await mongoManager.hasAccessGrant({
			userId: user.id,
			roleIds,
			serverIds
		}))
	) {
		throw new LoginRejected(
			"not-authorized",
			`no access grant for Discord user ${user.id}`
		);
	}

	await setSessionCookie(res, { user, loginAt: Date.now() }, config);
}

function isExpectedState(state: string, req: Request): boolean {
	const expected: unknown = req.cookies[LOGIN_STATE_COOKIE];
	if (typeof expected !== "string") {
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
