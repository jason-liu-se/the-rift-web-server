// Refresh tokens, rotated on every use with reuse detection (OAuth 2.0
// Security BCP, "refresh token rotation"). Each Discord login starts a
// session: one Redis record, under a random session ID, holding the hash of
// its current refresh token. A user can have any number of sessions (devices,
// browsers), each refreshed and ended on its own.
//
// A refresh token is `<session ID>.<secret>`. POST /auth/refresh trades it for
// a new one, and the old one stops working. If an old one comes back, two
// parties hold the session's tokens (one stole them), and there's no telling
// which is the user, so the whole session is ended: both must log in again.
//
// Except within REFRESH_GRACE_MS of its rotation: then the old token is
// accepted again and answers with the same new token, so two tabs refreshing
// at once, or a retry after a lost response, don't end the session. That's why
// the next secret is derived from the old one (an HMAC keyed by JWT_SECRET)
// rather than random: every retry computes the same token, and the browser
// ends up with the right cookie whichever response it applies last, without
// the database ever holding a usable token.
//
// Only the secret's SHA-256 hash is stored, so a leaked database holds no
// usable tokens. A session's record expires when the session ends
// (sessionEndsAt): SESSION_IDLE_TIMEOUT_MS after its last refresh, and
// SESSION_MAX_AGE_MS after its login at the latest. It can't be refreshed after
// that.
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as z from "zod";
import { REFRESH_GRACE_MS } from "../config/auth.ts";
import * as redisManager from "../helpers/redis-manager.ts";
import { sessionEndsAt, type Session } from "./session.ts";

const SESSION_ID_BYTES = 16;
const SECRET_BYTES = 32;
// base64url without padding: 16 bytes are 22 characters, 32 bytes are 43.
const REFRESH_TOKEN_FORMAT = /^([\w-]{22})\.([\w-]{43})$/;

// What Redis holds for a session, all strings. The profile lets a refresh sign
// a new access token without asking Discord again.
const storedSession = z.object({
	discordUserId: z.string().min(1),
	username: z.string(),
	avatarUrl: z.string().optional(),
	/** SHA-256 of the current refresh token's secret. */
	refreshTokenHash: z.string().min(1),
	/** When the current refresh token was issued (at login or a refresh). */
	createdAt: z.iso.datetime(),
	/** Until when (ms) the previous token is accepted again; unset before the first refresh. */
	graceEndsAt: z.string().optional(),
	/** When the user logged in through Discord; the session ends SESSION_MAX_AGE_MS on at the latest. */
	loginAt: z.iso.datetime()
});

export type StoredSession = z.infer<typeof storedSession>;

export interface RefreshedSession {
	readonly session: Session;
	readonly refreshToken: string;
}

function randomToken(bytes: number): string {
	return randomBytes(bytes).toString("base64url");
}

function hash(secret: string): string {
	return createHash("sha256").update(secret).digest("base64url");
}

// 32 bytes, like a random secret. Labelled, so the key's other use (signing
// access tokens) can never produce the same value.
function nextSecret(secret: string, key: string): string {
	return createHmac("sha256", key)
		.update(`refresh-token:${secret}`)
		.digest("base64url");
}

function parseRefreshToken(
	token: string
): { sessionId: string; secret: string } | undefined {
	const [, sessionId, secret] = REFRESH_TOKEN_FORMAT.exec(token) ?? [];
	return sessionId && secret ? { sessionId, secret } : undefined;
}

// Starts a session at its login; returns its first refresh token.
export async function startSession({
	user,
	loginAt
}: Session): Promise<string> {
	const sessionId = randomToken(SESSION_ID_BYTES);
	const secret = randomToken(SECRET_BYTES);
	const now = Date.now();
	const stored: StoredSession = {
		discordUserId: user.id,
		username: user.username,
		...(user.avatarUrl && { avatarUrl: user.avatarUrl }),
		refreshTokenHash: hash(secret),
		createdAt: new Date(now).toISOString(),
		loginAt: new Date(loginAt).toISOString()
	};

	await redisManager.createSession(
		sessionId,
		stored,
		sessionEndsAt(loginAt, now)
	);
	return `${sessionId}.${secret}`;
}

// Rotates the token, returning its session and the new token; undefined if
// the token is malformed, its session is over, or it was already used (which
// ends its session). `key` is JWT_SECRET.
export async function refreshSession(
	token: string,
	key: string
): Promise<RefreshedSession | undefined> {
	const parsed = parseRefreshToken(token);
	if (!parsed) {
		return undefined;
	}

	const { sessionId, secret } = parsed;
	const newSecret = nextSecret(secret, key);
	const now = Date.now();
	const result = await redisManager.rotateRefreshToken(sessionId, {
		presentedHash: hash(secret),
		nextHash: hash(newSecret),
		createdAt: new Date(now).toISOString(),
		now,
		graceEndsAt: now + REFRESH_GRACE_MS
	});

	switch (result.outcome) {
		case "missing":
			return undefined;
		case "reused":
			console.warn(
				`A used refresh token was presented again; ended session ${sessionId}` +
					` of Discord user ${result.discordUserId || "(unknown)"}`
			);
			return undefined;
		case "rotated":
		case "repeated": {
			// Either way the user is active, so restart the idle timeout.
			const session = toSession(parseStoredSession(result.fields));
			await extendSession(
				sessionId,
				sessionEndsAt(session.loginAt, now),
				session.user.id
			);
			return { session, refreshToken: `${sessionId}.${newSecret}` };
		}
	}
}

// The rotation has already committed, so failing the refresh here would leave
// the browser with a used token, ending the session once the grace window
// passes. Logged instead: the session keeps its earlier, still future, expiry.
// Logs the Discord user, never the session ID or token.
async function extendSession(
	sessionId: string,
	expiresAt: number,
	discordUserId: string
): Promise<void> {
	try {
		await redisManager.extendSession(sessionId, expiresAt);
	} catch (error) {
		console.error(
			`ERROR: couldn't extend a session of Discord user ${discordUserId}:`,
			error
		);
	}
}

// Idempotent: an unknown or malformed token has no session to end.
export async function endSession(token: string): Promise<void> {
	const parsed = parseRefreshToken(token);
	if (parsed) {
		await redisManager.deleteSession(parsed.sessionId);
	}
}

// Written by us, but a malformed record shouldn't become a session.
function parseStoredSession(stored: redisManager.SessionFields): StoredSession {
	const parsed = storedSession.safeParse(stored);
	if (!parsed.success) {
		throw new Error(
			`stored session is malformed:\n${z.prettifyError(parsed.error)}`
		);
	}
	return parsed.data;
}

function toSession({
	discordUserId,
	username,
	avatarUrl,
	loginAt
}: StoredSession): Session {
	return {
		user: { id: discordUserId, username, ...(avatarUrl && { avatarUrl }) },
		loginAt: Date.parse(loginAt)
	};
}
