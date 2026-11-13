// An in-memory stand-in for src/helpers/redis-manager.ts, so tests need no
// Redis. It keeps the same contract: sessions expire at their time (by
// Date.now(), so fake timers apply) and rotation is a compare-and-swap. Use it
// with
//   vi.mock(import("<path to>/helpers/redis-manager.ts"), () => import("<path to>/test/redis.ts"))
// and clearRedis in afterEach.
import type * as RedisManager from "../src/helpers/redis-manager.ts";

interface Entry {
	readonly fields: RedisManager.SessionFields;
	readonly expiresAt: number;
}

const sessions = new Map<string, Entry>();

function live(sessionId: string): Entry | undefined {
	const entry = sessions.get(sessionId);
	return entry && entry.expiresAt > Date.now() ? entry : undefined;
}

export const connect: typeof RedisManager.connect = async () => undefined;

export const disconnect: typeof RedisManager.disconnect = async () => undefined;

export const createSession: typeof RedisManager.createSession = async (
	sessionId,
	fields,
	expiresAt
) => {
	sessions.set(sessionId, { fields: { ...fields }, expiresAt });
};

// Mirrors ROTATE_SCRIPT in redis-manager.ts.
export const rotateRefreshToken: typeof RedisManager.rotateRefreshToken =
	async (
		sessionId,
		{ presentedHash, nextHash, createdAt, now, graceEndsAt }
	) => {
		const entry = live(sessionId);
		if (!entry) {
			return { outcome: "missing" };
		}

		const { refreshTokenHash, discordUserId } = entry.fields;
		if (refreshTokenHash === presentedHash) {
			const fields = {
				...entry.fields,
				refreshTokenHash: nextHash,
				createdAt,
				graceEndsAt: String(graceEndsAt)
			};
			sessions.set(sessionId, { ...entry, fields });
			return { outcome: "rotated", fields: { ...fields } };
		}
		if (
			refreshTokenHash === nextHash &&
			now < Number(entry.fields["graceEndsAt"])
		) {
			return { outcome: "repeated", fields: { ...entry.fields } };
		}
		sessions.delete(sessionId);
		return { outcome: "reused", discordUserId: discordUserId ?? "" };
	};

export const deleteSession: typeof RedisManager.deleteSession = async (
	sessionId
) => {
	sessions.delete(sessionId);
};

export function clearRedis(): void {
	sessions.clear();
}

/** The unexpired sessions, by ID. */
export function storedSessions(): Map<string, Entry> {
	return new Map(
		[...sessions.keys()].flatMap((sessionId) => {
			const entry = live(sessionId);
			return entry ? [[sessionId, entry] as const] : [];
		})
	);
}
