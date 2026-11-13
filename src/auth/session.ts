// Stateless sessions: a signed JWT (HS512) holds the logged-in user, so there's
// no session store and restarts don't log anyone out. Rotating JWT_SECRET
// invalidates every session at once.
//
// A token is short-lived and re-issued while its session lasts, which is
// SESSION_MAX_AGE_MS from the Discord login. Access isn't re-checked with
// Discord when a token is re-issued: a removed role or access grant only takes
// effect at the next login.
import { SignJWT, errors, jwtVerify } from "jose";
import * as z from "zod";
import type { SessionUser } from "../contract/api-responses.ts";

const ALGORITHM = "HS512";

/** How long one token is valid before it must be re-issued, in seconds. */
export const SESSION_TOKEN_TTL_SECONDS = 15 * 60;

/** How long after the Discord login a session ends, in milliseconds. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface Session {
	readonly user: SessionUser;
	/** When the user logged in through Discord, in ms since the epoch. */
	readonly loginAt: number;
}

export type VerifiedSession = Session & {
	/** The token's `exp` has passed (but its signature is valid). */
	readonly isTokenExpired: boolean;
};

// The claims are signed by us, but parse them anyway so a token signed with an
// older claim layout can't produce a malformed user.
const sessionClaims = z.object({
	sub: z.string().min(1),
	username: z.string(),
	avatarUrl: z.string().optional(),
	loginAt: z.number().int()
});

function encodeSecret(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

export async function signSession(
	{ user, loginAt }: Session,
	secret: string
): Promise<string> {
	return new SignJWT({
		username: user.username,
		avatarUrl: user.avatarUrl,
		loginAt
	})
		.setProtectedHeader({ alg: ALGORITHM })
		.setSubject(user.id)
		.setIssuedAt()
		.setExpirationTime(`${SESSION_TOKEN_TTL_SECONDS}s`)
		.sign(encodeSecret(secret));
}

// Returns undefined for any token that isn't ours: a bad signature, another
// algorithm (including "none"), or malformed claims. An expired token is still
// returned, flagged, because its signature was checked before its expiry
// (jose authenticates before validating claims) and its session may continue.
export async function verifySession(
	token: string,
	secret: string
): Promise<VerifiedSession | undefined> {
	let payload: unknown;
	let isTokenExpired = false;

	try {
		({ payload } = await jwtVerify(token, encodeSecret(secret), {
			algorithms: [ALGORITHM]
		}));
	} catch (error) {
		if (!(error instanceof errors.JWTExpired)) {
			return undefined;
		}
		payload = error.payload;
		isTokenExpired = true;
	}

	const claims = sessionClaims.safeParse(payload);
	if (!claims.success) {
		return undefined;
	}

	const { sub, username, avatarUrl, loginAt } = claims.data;
	return {
		user: { id: sub, username, ...(avatarUrl && { avatarUrl }) },
		loginAt,
		isTokenExpired
	};
}

export function isSessionOver(loginAt: number, now = Date.now()): boolean {
	return now - loginAt >= SESSION_MAX_AGE_MS;
}
