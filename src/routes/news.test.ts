import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

function seedNews() {
	return collection("news", "news-items").insertMany([
		{ title: "Oldest", date: new Date("2024-01-01"), content: "a" },
		{
			title: "Newest",
			date: new Date("2025-01-01"),
			content: "b",
			bannerImg: "banner.png"
		},
		{ title: "Middle", date: new Date("2024-06-01"), content: "c" }
	]);
}

describe("GET /news", () => {
	it("returns every item newest first with the total", async () => {
		await seedNews();

		const res = await request(app).get("/news").expect(200);

		expect(res.body.total).toBe(3);
		expect(res.body.items).toMatchObject([
			{
				title: "Newest",
				date: "2025-01-01T00:00:00.000Z",
				content: "b",
				bannerImg: "banner.png"
			},
			{ title: "Middle", date: "2024-06-01T00:00:00.000Z", content: "c" },
			{ title: "Oldest", date: "2024-01-01T00:00:00.000Z", content: "a" }
		]);
	});

	it("returns the page selected by startIndex and limit", async () => {
		await seedNews();

		const res = await request(app)
			.get("/news?startIndex=1&limit=1")
			.expect(200);

		expect(res.body.total).toBe(3);
		expect(res.body.items).toHaveLength(1);
		expect(res.body.items[0].title).toBe("Middle");
	});

	it("returns an empty page when there is no news", async () => {
		const res = await request(app).get("/news").expect(200);

		expect(res.body).toEqual({ items: [], total: 0 });
	});

	it.each(["limit=0", "limit=abc", "startIndex=-1", "startIndex=1.5"])(
		"rejects invalid pagination (%s)",
		async (query) => {
			const res = await request(app).get(`/news?${query}`).expect(400);

			expect(res.body.error).toMatch(
				/^ERROR: invalid request parameters/
			);
		}
	);
});

describe("GET /news/count", () => {
	it("returns the number of news items", async () => {
		await seedNews();

		const res = await request(app).get("/news/count").expect(200);

		expect(res.body).toEqual({ total: 3 });
	});

	it("returns 0 when there is no news", async () => {
		const res = await request(app).get("/news/count").expect(200);

		expect(res.body).toEqual({ total: 0 });
	});
});
