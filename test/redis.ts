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

export const getSession: typeof RedisManager.getSession = async (sessionId) => {
	const entry = live(sessionId);
	return entry && { ...entry.fields };
};

export const rotateRefreshToken: typeof RedisManager.rotateRefreshToken =
	async (sessionId, expectedHash, newHash, createdAt) => {
		const entry = live(sessionId);
		if (!entry) {
			return "missing";
		}
		if (entry.fields["refreshTokenHash"] !== expectedHash) {
			return "mismatch";
		}
		sessions.set(sessionId, {
			...entry,
			fields: { ...entry.fields, refreshTokenHash: newHash, createdAt }
		});
		return "rotated";
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
