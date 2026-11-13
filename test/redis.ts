// An in-memory stand-in for src/helpers/redis-manager.ts, so tests need no
// Redis. It keeps the same contract: values expire at their time (by Date.now(),
// so fake timers apply) and a take reads and deletes. Use it with
//   vi.mock(import("<path to>/helpers/redis-manager.ts"), () => import("<path to>/test/redis.ts"))
// and clearRedis in afterEach.
import type * as RedisManager from "../src/helpers/redis-manager.ts";

interface Entry {
	readonly value: string;
	readonly expiresAt: number;
}

const entries = new Map<string, Entry>();

function live(tokenHash: string): Entry | undefined {
	const entry = entries.get(tokenHash);
	return entry && entry.expiresAt > Date.now() ? entry : undefined;
}

export const connect: typeof RedisManager.connect = async () => undefined;

export const disconnect: typeof RedisManager.disconnect = async () => undefined;

export const saveRefreshToken: typeof RedisManager.saveRefreshToken = async (
	tokenHash,
	value,
	expiresAt
) => {
	entries.set(tokenHash, { value, expiresAt });
};

export const takeRefreshToken: typeof RedisManager.takeRefreshToken = async (
	tokenHash
) => {
	const entry = live(tokenHash);
	entries.delete(tokenHash);
	return entry?.value;
};

export const deleteRefreshToken: typeof RedisManager.deleteRefreshToken =
	async (tokenHash) => {
		entries.delete(tokenHash);
	};

export function clearRedis(): void {
	entries.clear();
}

/** The unexpired stored values, parsed, with their expiry. */
export function storedRefreshTokens(): { value: unknown; expiresAt: number }[] {
	return [...entries.keys()]
		.map((tokenHash) => live(tokenHash))
		.filter((entry) => entry !== undefined)
		.map(({ value, expiresAt }) => ({
			value: JSON.parse(value),
			expiresAt
		}));
}
