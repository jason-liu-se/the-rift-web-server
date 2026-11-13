// Refresh tokens: random, opaque, single-use tokens that POST /auth/refresh
// trades for a new access token and a new refresh token (rotation). Each is
// stored in Redis under its SHA-256 hash, so a leaked database holds no usable
// tokens, and expires with its session (SESSION_MAX_AGE_MS after the Discord
// login), so a session can't be refreshed past that.
import { createHash, randomBytes } from "node:crypto";
import * as z from "zod";
import * as redisManager from "../helpers/redis-manager.ts";
import { sessionEndsAt, type Session } from "./session.ts";

const REFRESH_TOKEN_BYTES = 32;

// What Redis holds for a refresh token. The profile lets a refresh sign a new
// access token without asking Discord again.
const storedRefreshToken = z.object({
	discordUserId: z.string().min(1),
	username: z.string(),
	avatarUrl: z.string().optional(),
	/** When this token was issued (its session's login, or a refresh). */
	createdAt: z.iso.datetime(),
	/** When the user logged in through Discord; the session ends 30 days on. */
	loginAt: z.iso.datetime()
});

export type StoredRefreshToken = z.infer<typeof storedRefreshToken>;

function hash(token: string): string {
	return createHash("sha256").update(token).digest("base64url");
}

export async function issueRefreshToken({
	user,
	loginAt
}: Session): Promise<string> {
	const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
	const stored: StoredRefreshToken = {
		discordUserId: user.id,
		username: user.username,
		...(user.avatarUrl && { avatarUrl: user.avatarUrl }),
		createdAt: new Date().toISOString(),
		loginAt: new Date(loginAt).toISOString()
	};

	await redisManager.saveRefreshToken(
		hash(token),
		JSON.stringify(stored),
		sessionEndsAt(loginAt)
	);
	return token;
}

// Consumes the token, returning its session; undefined if it's unknown,
// already used, or its session is over.
export async function redeemRefreshToken(
	token: string
): Promise<Session | undefined> {
	const value = await redisManager.takeRefreshToken(hash(token));
	if (value === undefined) {
		return undefined;
	}

	// Written by us, but a malformed record shouldn't become a session.
	const parsed = storedRefreshToken.safeParse(JSON.parse(value));
	if (!parsed.success) {
		throw new Error(
			`stored refresh token is malformed:\n${z.prettifyError(parsed.error)}`
		);
	}

	const { discordUserId, username, avatarUrl, loginAt } = parsed.data;
	return {
		user: { id: discordUserId, username, ...(avatarUrl && { avatarUrl }) },
		loginAt: Date.parse(loginAt)
	};
}

export async function revokeRefreshToken(token: string): Promise<void> {
	await redisManager.deleteRefreshToken(hash(token));
}
