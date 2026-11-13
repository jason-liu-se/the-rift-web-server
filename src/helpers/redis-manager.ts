// Redis access: the connection and every command. Holds one hash per login
// session, keyed by its random ID; src/auth/refresh-tokens.ts decides what
// goes in it. Command errors propagate to the caller; the app's error handler
// turns them into 500 responses.
import { createClient } from "redis";

const SESSION_PREFIX = "session:";

/** A session's stored fields, as Redis returns them. */
export type SessionFields = Record<string, string>;

export type RotateResult = "rotated" | "mismatch" | "missing";

// Compare-and-swap on the session's refresh token hash, atomically, so two
// requests can't both rotate the same token. KEYS[1]: the session; ARGV: the
// presented token's hash, the new token's hash, the new token's createdAt.
const ROTATE_SCRIPT = `
local current = redis.call("HGET", KEYS[1], "refreshTokenHash")
if not current then return "missing" end
if current ~= ARGV[1] then return "mismatch" end
redis.call("HSET", KEYS[1], "refreshTokenHash", ARGV[2], "createdAt", ARGV[3])
return "rotated"
`;
const ROTATE_RESULTS = new Set<unknown>([
	"rotated",
	"mismatch",
	"missing"
] satisfies RotateResult[]);

function isRotateResult(value: unknown): value is RotateResult {
	return ROTATE_RESULTS.has(value);
}
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

function sessionKey(sessionId: string): string {
	return `${SESSION_PREFIX}${sessionId}`;
}

/** Stores a new session until `expiresAt` (ms since the epoch). */
export async function createSession(
	sessionId: string,
	fields: SessionFields,
	expiresAt: number
): Promise<void> {
	const key = sessionKey(sessionId);
	await connectedClient()
		.multi()
		.hSet(key, fields)
		.pExpireAt(key, expiresAt)
		.exec();
}

// Undefined once the session is deleted or expired.
export async function getSession(
	sessionId: string
): Promise<SessionFields | undefined> {
	const fields = await connectedClient().hGetAll(sessionKey(sessionId));
	return Object.keys(fields).length > 0 ? fields : undefined;
}

// Replaces the session's refresh token hash with `newHash`, but only if it's
// still `expectedHash`. The session keeps its expiry.
export async function rotateRefreshToken(
	sessionId: string,
	expectedHash: string,
	newHash: string,
	createdAt: string
): Promise<RotateResult> {
	const result = await connectedClient().eval(ROTATE_SCRIPT, {
		keys: [sessionKey(sessionId)],
		arguments: [expectedHash, newHash, createdAt]
	});
	if (!isRotateResult(result)) {
		throw new Error(`unexpected rotate script reply: ${String(result)}`);
	}
	return result;
}

export async function deleteSession(sessionId: string): Promise<void> {
	await connectedClient().del(sessionKey(sessionId));
}
