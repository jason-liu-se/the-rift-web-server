import { describe, expect, it } from "vitest";
import {
	AUTH_RATE_LIMIT,
	AUTH_RATE_LIMIT_WINDOW_MS,
	DEFAULT_READ_RATE_LIMIT_WITHOUT_TUNNEL,
	READ_RATE_LIMIT,
	READ_RATE_LIMIT_WINDOW_MS,
	WRITE_RATE_LIMIT,
	WRITE_RATE_LIMIT_WINDOW_MS
} from "./rate-limits.ts";

// Requests per ms, so limits over different windows compare fairly.
function rate(limit: number, windowMs: number): number {
	return limit / windowMs;
}

// Logging in is the most sensitive, then changing things, then reading: each
// limiter must be at most as generous as the next.
describe("rate limits", () => {
	const auth = rate(AUTH_RATE_LIMIT, AUTH_RATE_LIMIT_WINDOW_MS);
	const write = rate(WRITE_RATE_LIMIT, WRITE_RATE_LIMIT_WINDOW_MS);
	const read = rate(READ_RATE_LIMIT, READ_RATE_LIMIT_WINDOW_MS);
	const readWithoutTunnel = rate(
		DEFAULT_READ_RATE_LIMIT_WITHOUT_TUNNEL,
		READ_RATE_LIMIT_WINDOW_MS
	);

	it("allow no more logins than writes", () => {
		expect(auth).toBeLessThanOrEqual(write);
	});

	it("allow no more writes than reads, with or without the tunnel", () => {
		expect(write).toBeLessThanOrEqual(read);
		expect(write).toBeLessThanOrEqual(readWithoutTunnel);
	});
});
