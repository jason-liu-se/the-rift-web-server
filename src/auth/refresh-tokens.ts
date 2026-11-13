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
// Only the secret's SHA-256 hash is stored, so a leaked database holds no
// usable tokens. A session's record expires SESSION_MAX_AGE_MS after its login,
// so it can't be refreshed past that.
import { createHash, randomBytes } from "node:crypto";
import * as z from "zod";
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
	/** When the user logged in through Discord; the session ends 30 days on. */
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
	const stored: StoredSession = {
		discordUserId: user.id,
		username: user.username,
		...(user.avatarUrl && { avatarUrl: user.avatarUrl }),
		refreshTokenHash: hash(secret),
		createdAt: new Date().toISOString(),
		loginAt: new Date(loginAt).toISOString()
	};

	await redisManager.createSession(sessionId, stored, sessionEndsAt(loginAt));
	return `${sessionId}.${secret}`;
}

// Rotates the token, returning its session and the new token; undefined if
// the token is malformed, its session is over, or it was already used (which
// ends its session).
export async function refreshSession(
	token: string
): Promise<RefreshedSession | undefined> {
	const parsed = parseRefreshToken(token);
	if (!parsed) {
		return undefined;
	}

	const { sessionId, secret } = parsed;
	const newSecret = randomToken(SECRET_BYTES);
	const result = await redisManager.rotateRefreshToken(
		sessionId,
		hash(secret),
		hash(newSecret),
		new Date().toISOString()
	);

	if (result === "missing") {
		return undefined;
	}
	if (result === "mismatch") {
		await endStolenSession(sessionId);
		return undefined;
	}

	const stored = await redisManager.getSession(sessionId);
	if (!stored) {
		// Ended (logged out) between the rotation and this read.
		return undefined;
	}
	return {
		session: toSession(parseStoredSession(stored)),
		refreshToken: `${sessionId}.${newSecret}`
	};
}

// Idempotent: an unknown or malformed token has no session to end.
export async function endSession(token: string): Promise<void> {
	const parsed = parseRefreshToken(token);
	if (parsed) {
		await redisManager.deleteSession(parsed.sessionId);
	}
}

async function endStolenSession(sessionId: string): Promise<void> {
	const stored = await redisManager.getSession(sessionId);
	await redisManager.deleteSession(sessionId);
	console.warn(
		`A used refresh token was presented again; ended session ${sessionId}` +
			` of Discord user ${stored?.["discordUserId"] ?? "(unknown)"}`
	);
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
