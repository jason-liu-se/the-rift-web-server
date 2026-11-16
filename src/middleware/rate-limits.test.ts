import { describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../app.ts";
import {
	AUTH_RATE_LIMIT,
	READ_RATE_LIMIT,
	WRITE_RATE_LIMIT
} from "../config/rate-limits.ts";
import { testConfig } from "../../test/app.ts";
import { EDITOR, sessionCookie } from "../../test/session.ts";

const TOO_MANY_REQUESTS = {
	error: "ERROR: too many requests; try again later"
};

// A fresh app per test, so other tests' requests don't count.
function freshApp(): Express {
	return createApp(testConfig);
}

// No route accepts writes yet, so a logged-in write reaching the routers
// answers 404; the limiters run before them.
function write(target: Express, cookie?: string) {
	const req = request(target)
		.delete("/news/some-id")
		.set("Origin", testConfig.FRONTEND_URL);
	return cookie ? req.set("Cookie", cookie) : req;
}

async function useUpWriteBudget(target: Express, cookie: string) {
	for (let i = 0; i < WRITE_RATE_LIMIT; i++) {
		expect((await write(target, cookie)).status).toBe(404);
	}
}

function logout(target: Express) {
	return request(target)
		.post("/auth/logout")
		.set("Origin", testConfig.FRONTEND_URL);
}

// The auth limiter on /auth itself is tested in src/routes/auth.test.ts.
describe("auth rate limit on private routes", () => {
	it("counts logged-out requests to private and unknown paths with /auth", async () => {
		const app = freshApp();
		for (let i = 0; i < AUTH_RATE_LIMIT / 2; i++) {
			await request(app).get("/auth/me").expect(401);
			await request(app).get("/does-not-exist").expect(401);
		}

		const res = await request(app).get("/news/drafts").expect(429);

		expect(res.body).toEqual(TOO_MANY_REQUESTS);
		await request(app).get("/auth/me").expect(429);
	});

	it("never counts a logged-in editor's private requests against it", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);

		for (let i = 0; i <= AUTH_RATE_LIMIT; i++) {
			await request(app)
				.get("/news/drafts")
				.set("Cookie", cookie)
				.expect(404);
		}
	});
});

describe("write rate limit", () => {
	const OTHER_EDITOR = { id: "456", username: "other" };

	it("answers 429 once an editor exceeds the limit", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);
		await useUpWriteBudget(app, cookie);

		const res = await write(app, cookie);

		expect(res.status).toBe(429);
		expect(res.body).toEqual(TOO_MANY_REQUESTS);
		expect(res.headers).toHaveProperty("retry-after");
	});

	it("counts each editor separately, and never their reads", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);
		await useUpWriteBudget(app, cookie);

		const other = await write(app, await sessionCookie(OTHER_EDITOR));
		expect(other.status).toBe(404);
		await request(app)
			.get("/news/drafts")
			.set("Cookie", cookie)
			.expect(404);
	});

	it("counts logged-out public writes by IP", async () => {
		const app = freshApp();
		// Under the auth limit, so only the write limiter can refuse.
		for (let i = 0; i < WRITE_RATE_LIMIT; i++) {
			await logout(app).expect(204);
		}

		const res = await logout(app).expect(429);

		expect(res.body).toEqual(TOO_MANY_REQUESTS);
	});

	it("doesn't count logged-out private writes, which the gate refuses", async () => {
		const app = freshApp();
		for (let i = 0; i <= WRITE_RATE_LIMIT; i++) {
			await write(app).expect(401);
		}
	});

	it("keeps a separate budget from the auth limiter", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);

		// All but one of the auth budget...
		for (let i = 0; i < AUTH_RATE_LIMIT - 1; i++) {
			await request(app)
				.get("/auth/me")
				.set("Cookie", cookie)
				.expect(200);
		}
		// ...doesn't touch the write budget...
		await useUpWriteBudget(app, cookie);

		// ...and the writes didn't touch the auth budget.
		await request(app).get("/auth/me").set("Cookie", cookie).expect(200);
	});
});

describe("read rate limit", () => {
	function read(target: Express, cookie?: string) {
		const req = request(target).get("/news/drafts");
		return cookie ? req.set("Cookie", cookie) : req;
	}

	async function useUpReadBudget(target: Express, cookie: string) {
		for (let i = 0; i < READ_RATE_LIMIT; i++) {
			expect((await read(target, cookie)).status).toBe(404);
		}
	}

	async function useUpPublicReads(target: Express, count: number) {
		for (let i = 0; i < count; i++) {
			await request(target).get("/health").expect(200);
		}
	}

	it("answers 429 once a client exceeds the limit on public reads", async () => {
		const app = createApp({
			...testConfig,
			BEHIND_CLOUDFLARE_TUNNEL: true
		});
		await useUpPublicReads(app, READ_RATE_LIMIT);

		const res = await request(app).get("/health").expect(429);

		expect(res.body).toEqual(TOO_MANY_REQUESTS);
		expect(res.headers).toHaveProperty("retry-after");
	});

	it("gives logged-out reads READ_RATE_LIMIT_WITHOUT_TUNNEL without the tunnel", async () => {
		const limit = READ_RATE_LIMIT + 5;
		const app = createApp({
			...testConfig,
			READ_RATE_LIMIT_WITHOUT_TUNNEL: limit
		});
		await useUpPublicReads(app, limit);

		await request(app).get("/health").expect(429);
	});

	it("counts a logged-in editor by user, not by IP", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);
		await useUpReadBudget(app, cookie);

		await read(app, cookie).expect(429);
		await request(app).get("/health").expect(200);
	});

	it("counts each visitor separately behind the Cloudflare Tunnel", async () => {
		const app = createApp({
			...testConfig,
			BEHIND_CLOUDFLARE_TUNNEL: true
		});
		const health = (ip: string) =>
			request(app).get("/health").set("CF-Connecting-IP", ip);
		for (let i = 0; i < READ_RATE_LIMIT; i++) {
			await health("203.0.113.1").expect(200);
		}

		await health("203.0.113.1").expect(429);
		await health("203.0.113.2").expect(200);
	});

	it("leaves /auth to the auth limiter, and writes to the write limiter", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);
		await useUpReadBudget(app, cookie);

		await request(app).get("/auth/me").set("Cookie", cookie).expect(200);
		// Express routes /auth case-insensitively, so this is /auth too.
		await request(app).get("/AUTH/me").set("Cookie", cookie).expect(200);
		expect((await write(app, cookie)).status).toBe(404);
	});
});

describe("client IP", () => {
	function me(target: Express, ip: string) {
		return request(target).get("/auth/me").set("CF-Connecting-IP", ip);
	}

	async function useUpAuthBudget(target: Express, ip: string) {
		for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
			await me(target, ip).expect(401);
		}
	}

	it("comes from CF-Connecting-IP behind the Cloudflare Tunnel", async () => {
		const app = createApp({
			...testConfig,
			BEHIND_CLOUDFLARE_TUNNEL: true
		});
		await useUpAuthBudget(app, "203.0.113.1");

		await me(app, "203.0.113.1").expect(429);
		await me(app, "203.0.113.2").expect(401);
	});

	it("ignores CF-Connecting-IP otherwise, so callers can't pick it", async () => {
		const app = freshApp();
		await useUpAuthBudget(app, "203.0.113.1");

		await me(app, "203.0.113.2").expect(429);
	});
});
