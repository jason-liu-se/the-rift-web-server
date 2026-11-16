import { describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../app.ts";
import { AUTH_RATE_LIMIT, WRITE_RATE_LIMIT } from "../config/rate-limits.ts";
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

	it("never counts a logged-in editor's private requests", async () => {
		const app = freshApp();
		const cookie = await sessionCookie(EDITOR);

		for (let i = 0; i <= AUTH_RATE_LIMIT; i++) {
			await request(app)
				.get("/news/drafts")
				.set("Cookie", cookie)
				.expect(404);
		}
	});

	it("leaves public reads unlimited", async () => {
		const app = freshApp();
		for (let i = 0; i <= AUTH_RATE_LIMIT; i++) {
			await request(app).get("/health").expect(200);
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
