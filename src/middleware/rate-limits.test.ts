import { describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../app.ts";
import { WRITE_RATE_LIMIT } from "../config/rate-limits.ts";
import { testConfig } from "../../test/app.ts";
import { EDITOR, sessionCookie } from "../../test/session.ts";

// The auth limiter's own tests are in src/routes/auth.test.ts.
describe("write rate limit", () => {
	const OTHER_EDITOR = { id: "456", username: "other" };

	// No route accepts writes yet, so a write reaching the routers answers 404;
	// the limiter runs before them.
	function write(target: Express, cookie: string) {
		return request(target)
			.delete("/news/some-id")
			.set("Origin", testConfig.FRONTEND_URL)
			.set("Cookie", cookie);
	}

	async function useUpWriteBudget(target: Express, cookie: string) {
		for (let i = 0; i < WRITE_RATE_LIMIT; i++) {
			expect((await write(target, cookie)).status).toBe(404);
		}
	}

	it("answers 429 once an editor exceeds the limit", async () => {
		// A fresh app, so other tests' requests don't count.
		const limitedApp = createApp(testConfig);
		const cookie = await sessionCookie(EDITOR);
		await useUpWriteBudget(limitedApp, cookie);

		const res = await write(limitedApp, cookie);

		expect(res.status).toBe(429);
		expect(res.body).toEqual({
			error: "ERROR: too many requests; try again later"
		});
		expect(res.headers).toHaveProperty("retry-after");
	});

	it("counts each editor separately, and never their reads", async () => {
		const limitedApp = createApp(testConfig);
		const cookie = await sessionCookie(EDITOR);
		await useUpWriteBudget(limitedApp, cookie);

		const other = await write(
			limitedApp,
			await sessionCookie(OTHER_EDITOR)
		);
		expect(other.status).toBe(404);
		await request(limitedApp)
			.get("/news/drafts")
			.set("Cookie", cookie)
			.expect(404);
	});

	it("doesn't share a budget with the auth limiter", async () => {
		const limitedApp = createApp(testConfig);
		const cookie = await sessionCookie(EDITOR);

		// An editor's /auth POSTs don't use up their write budget...
		for (let i = 0; i < WRITE_RATE_LIMIT; i++) {
			await request(limitedApp)
				.post("/auth/logout")
				.set("Origin", testConfig.FRONTEND_URL)
				.set("Cookie", cookie)
				.expect(204);
		}
		await useUpWriteBudget(limitedApp, cookie);

		// ...and their writes don't use up the auth budget.
		await request(limitedApp)
			.get("/auth/me")
			.set("Cookie", cookie)
			.expect(200);
	});
});
