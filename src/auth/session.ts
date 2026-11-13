// Access tokens: a short-lived signed JWT (HS512) holding the logged-in user,
// so routes need no lookup. Rotating JWT_SECRET invalidates every access token
// at once.
//
// When one expires, the website calls POST /auth/refresh, which trades the
// refresh token (refresh-tokens.ts) for a new access token. A session ends
// SESSION_MAX_AGE_MS after the Discord login, however often it's refreshed.
// Access isn't re-checked with Discord on a refresh: a removed role or access
// grant only takes effect at the next login.
import { SignJWT, jwtVerify } from "jose";
import * as z from "zod";
import {
	SESSION_MAX_AGE_MS,
	SESSION_TOKEN_TTL_SECONDS
} from "../config/auth.ts";
import type { SessionUser } from "../contract/api-responses.ts";

const ALGORITHM = "HS512";

const MS_PER_SECOND = 1000;

export interface Session {
	readonly user: SessionUser;
	/** When the user logged in through Discord, in ms since the epoch. */
	readonly loginAt: number;
}

export interface AccessToken {
	readonly token: string;
	/** In ms since the epoch. */
	readonly expiresAt: number;
}

// The claims are signed by us, but parse them anyway so a token signed with an
// older claim layout can't produce a malformed user.
const sessionClaims = z.object({
	sub: z.string().min(1),
	username: z.string(),
	avatarUrl: z.string().optional()
});

function encodeSecret(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

export function sessionEndsAt(loginAt: number): number {
	return loginAt + SESSION_MAX_AGE_MS;
}

// Never valid past the end of the session.
export async function signSession(
	{ user, loginAt }: Session,
	secret: string
): Promise<AccessToken> {
	const expiresAt = Math.min(
		Date.now() + SESSION_TOKEN_TTL_SECONDS * MS_PER_SECOND,
		sessionEndsAt(loginAt)
	);
	const token = await new SignJWT({
		username: user.username,
		avatarUrl: user.avatarUrl
	})
		.setProtectedHeader({ alg: ALGORITHM })
		.setSubject(user.id)
		.setIssuedAt()
		.setExpirationTime(Math.floor(expiresAt / MS_PER_SECOND))
		.sign(encodeSecret(secret));
	return { token, expiresAt };
}

// Returns undefined for any token that isn't ours or has expired: a bad
// signature, another algorithm (including "none"), or malformed claims.
export async function verifySession(
	token: string,
	secret: string
): Promise<SessionUser | undefined> {
	let payload: unknown;
	try {
		({ payload } = await jwtVerify(token, encodeSecret(secret), {
			algorithms: [ALGORITHM]
		}));
	} catch {
		return undefined;
	}

	const claims = sessionClaims.safeParse(payload);
	if (!claims.success) {
		return undefined;
	}

	const { sub, username, avatarUrl } = claims.data;
	return { id: sub, username, ...(avatarUrl && { avatarUrl }) };
}
