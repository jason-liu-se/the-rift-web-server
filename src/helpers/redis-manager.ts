// Redis access: the connection and every command. Holds one hash per login
// session, keyed by its random ID; src/auth/refresh-tokens.ts decides what
// goes in it. Command errors propagate to the caller; the app's error handler
// turns them into 500 responses.
import { createClient } from "redis";
import {
	MAX_RECONNECT_DELAY_MS,
	RECONNECT_BASE_DELAY_MS
} from "../config/timeouts.ts";

const SESSION_PREFIX = "session:";

/** A session's stored fields, as Redis returns them. */
export type SessionFields = Record<string, string>;

export interface RotateRequest {
	/** Hash of the presented refresh token's secret. */
	readonly presentedHash: string;
	/** Hash of the secret that follows it (the same for every retry). */
	readonly nextHash: string;
	/** ISO date-time; becomes `createdAt` on a rotation. */
	readonly createdAt: string;
	/** In ms since the epoch. */
	readonly now: number;
	/** Until when (ms since the epoch) a rotation accepts the presented token again. */
	readonly graceEndsAt: number;
}

export type RotateResult =
	/** The presented token was current; `nextHash` now is. */
	| { readonly outcome: "rotated"; readonly fields: SessionFields }
	/** The presented token was just rotated, within its grace window. */
	| { readonly outcome: "repeated"; readonly fields: SessionFields }
	/** The presented token was used before; the session is deleted. */
	| { readonly outcome: "reused"; readonly discordUserId: string }
	| { readonly outcome: "missing" };

// One atomic step, so concurrent refreshes can't interleave: rotate when the
// presented hash is current; accept it again within the grace window (the
// current hash is then its successor's); otherwise delete the session.
// Returns the outcome, then the session's fields (flattened) or its user ID.
// KEYS[1]: the session. ARGV: presentedHash, nextHash, createdAt, now,
// graceEndsAt.
const ROTATE_SCRIPT = `
local current = redis.call("HGET", KEYS[1], "refreshTokenHash")
if not current then return {"missing"} end
if current == ARGV[1] then
	redis.call("HSET", KEYS[1], "refreshTokenHash", ARGV[2], "createdAt", ARGV[3], "graceEndsAt", ARGV[5])
	return {"rotated", unpack(redis.call("HGETALL", KEYS[1]))}
end
local graceEndsAt = tonumber(redis.call("HGET", KEYS[1], "graceEndsAt"))
if current == ARGV[2] and graceEndsAt and tonumber(ARGV[4]) < graceEndsAt then
	return {"repeated", unpack(redis.call("HGETALL", KEYS[1]))}
end
local discordUserId = redis.call("HGET", KEYS[1], "discordUserId") or ""
redis.call("DEL", KEYS[1])
return {"reused", discordUserId}
`;

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

export async function rotateRefreshToken(
	sessionId: string,
	{ presentedHash, nextHash, createdAt, now, graceEndsAt }: RotateRequest
): Promise<RotateResult> {
	const reply = await connectedClient().eval(ROTATE_SCRIPT, {
		keys: [sessionKey(sessionId)],
		arguments: [
			presentedHash,
			nextHash,
			createdAt,
			String(now),
			String(graceEndsAt)
		]
	});
	return parseRotateReply(reply);
}

function parseRotateReply(reply: unknown): RotateResult {
	const isStrings =
		Array.isArray(reply) &&
		reply.every((item): item is string => typeof item === "string");
	if (!isStrings) {
		throw new Error(`unexpected rotate script reply: ${String(reply)}`);
	}

	const [outcome, ...rest] = reply;
	if (outcome === "missing") {
		return { outcome };
	}
	if (outcome === "reused") {
		return { outcome, discordUserId: rest[0] ?? "" };
	}
	if (outcome === "rotated" || outcome === "repeated") {
		return { outcome, fields: pairsToFields(rest) };
	}
	throw new Error(`unexpected rotate script outcome: ${String(outcome)}`);
}

// HGETALL's flat [field, value, field, value, ...] reply as an object.
function pairsToFields(pairs: string[]): SessionFields {
	const fields: SessionFields = {};
	for (let i = 0; i + 1 < pairs.length; i += 2) {
		fields[pairs[i] ?? ""] = pairs[i + 1] ?? "";
	}
	return fields;
}

export async function deleteSession(sessionId: string): Promise<void> {
	await connectedClient().del(sessionKey(sessionId));
}
