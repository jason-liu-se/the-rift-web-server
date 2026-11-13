// Redis access: the connection and every command. Holds refresh tokens, keyed
// by their hash; src/auth/refresh-tokens.ts decides what goes in them. Command
// errors propagate to the caller; the app's error handler turns them into 500
// responses.
import { createClient } from "redis";

const REFRESH_TOKEN_PREFIX = "refresh-token:";
const RECONNECT_BASE_DELAY_MS = 50;
const MAX_RECONNECT_DELAY_MS = 2000;

let client: ReturnType<typeof createClient> | undefined;

function connectedClient(): ReturnType<typeof createClient> {
	if (!client) {
		throw new Error("Redis is not connected");
	}
	return client;
}

// Resolves once Redis is reachable; rejects if it can't connect, so callers
// don't serve requests without it. (By default the client would retry the
// first connection forever.) Once connected, a lost connection is logged and
// retried with backoff; commands fail until it's back.
export async function connect(url: string): Promise<void> {
	let hasConnected = false;
	client = createClient({
		url,
		socket: {
			reconnectStrategy: (retries, cause) =>
				hasConnected
					? Math.min(
							2 ** retries * RECONNECT_BASE_DELAY_MS,
							MAX_RECONNECT_DELAY_MS
						)
					: cause
		}
	});
	// Without a listener, a connection error would crash the process.
	client.on("error", (error: unknown) => {
		console.error("ERROR: Redis connection:", error);
	});
	await client.connect();
	hasConnected = true;
	console.log("Connected to Redis");
}

export async function disconnect(): Promise<void> {
	await client?.close();
	client = undefined;
	console.log("Disconnected from Redis");
}

/** Stores `value` until `expiresAt` (ms since the epoch). */
export async function saveRefreshToken(
	tokenHash: string,
	value: string,
	expiresAt: number
): Promise<void> {
	await connectedClient().set(`${REFRESH_TOKEN_PREFIX}${tokenHash}`, value, {
		expiration: { type: "PXAT", value: expiresAt }
	});
}

// Reads and deletes in one atomic command, so a token can be redeemed once
// even by concurrent requests. Undefined if it's missing or expired.
export async function takeRefreshToken(
	tokenHash: string
): Promise<string | undefined> {
	const value = await connectedClient().getDel(
		`${REFRESH_TOKEN_PREFIX}${tokenHash}`
	);
	return value ?? undefined;
}

export async function deleteRefreshToken(tokenHash: string): Promise<void> {
	await connectedClient().del(`${REFRESH_TOKEN_PREFIX}${tokenHash}`);
}
