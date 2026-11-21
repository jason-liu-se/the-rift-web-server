import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { app } from "../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { expectContractError } from "../../test/responses.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

const IDS = {
	oldest: new Types.ObjectId(),
	newest: new Types.ObjectId(),
	middle: new Types.ObjectId()
};

function seedNewsPosts() {
	return collection("news", "posts").insertMany([
		{
			_id: IDS.oldest,
			title: "Oldest",
			date: new Date("2024-01-01"),
			content: "a"
		},
		{
			_id: IDS.newest,
			title: "Newest",
			date: new Date("2025-01-01"),
			content: "b",
			imageUrl: "banner.png"
		},
		{
			_id: IDS.middle,
			title: "Middle",
			date: new Date("2024-06-01"),
			content: "c"
		}
	]);
}

describe("GET /news", () => {
	it("returns every item newest first with the total", async () => {
		await seedNewsPosts();

		const res = await request(app).get("/news").expect(200);

		expect(res.body.total).toBe(3);
		// toEqual: only the contract's fields, with _id as id and no __v
		expect(res.body.items).toEqual([
			{
				id: IDS.newest.toHexString(),
				title: "Newest",
				date: "2025-01-01T00:00:00.000Z",
				content: "b",
				imageUrl: "banner.png"
			},
			{
				id: IDS.middle.toHexString(),
				title: "Middle",
				date: "2024-06-01T00:00:00.000Z",
				content: "c"
			},
			{
				id: IDS.oldest.toHexString(),
				title: "Oldest",
				date: "2024-01-01T00:00:00.000Z",
				content: "a"
			}
		]);
	});

	it("leaves out hidden and scheduled posts", async () => {
		await Promise.all([
			seedNewsPosts(),
			collection("news", "posts").insertMany([
				{
					title: "Hidden",
					date: new Date("2024-03-01"),
					content: "h",
					visible: false
				},
				{
					title: "Scheduled",
					date: new Date(Date.now() + 60_000),
					content: "s",
					visible: true
				}
			])
		]);

		const [page, count] = await Promise.all([
			request(app).get("/news").expect(200),
			request(app).get("/news/count").expect(200)
		]);

		expect(
			page.body.items.map(({ title }: { title: string }) => title)
		).toEqual(["Newest", "Middle", "Oldest"]);
		expect(page.body.total).toBe(3);
		expect(count.body).toEqual({ total: 3 });
	});

	it("shows a scheduled post once its date has come", async () => {
		await collection("news", "posts").insertOne({
			title: "Soon",
			date: new Date(Date.now() + 50),
			content: "s"
		});
		await request(app).get("/news").expect(200, { items: [], total: 0 });

		await new Promise((resolve) => setTimeout(resolve, 100));
		const res = await request(app).get("/news").expect(200);

		expect(res.body.items).toMatchObject([{ title: "Soon" }]);
	});

	it("sends editedAt when the post has one", async () => {
		await collection("news", "posts").insertOne({
			title: "Edited",
			date: new Date("2024-01-01"),
			editedAt: new Date("2024-02-01"),
			content: "e"
		});

		const res = await request(app).get("/news").expect(200);

		expect(res.body.items).toMatchObject([
			{ title: "Edited", editedAt: "2024-02-01T00:00:00.000Z" }
		]);
	});

	it("returns the page selected by startIndex and limit", async () => {
		await seedNewsPosts();

		const res = await request(app)
			.get("/news?startIndex=1&limit=1")
			.expect(200);

		expect(res.body.total).toBe(3);
		expect(res.body.items).toHaveLength(1);
		expect(res.body.items[0].title).toBe("Middle");
	});

	it("returns an empty page when there are no news posts", async () => {
		const res = await request(app).get("/news").expect(200);

		expect(res.body).toEqual({ items: [], total: 0 });
	});

	it("answers 500 when a stored item breaks the contract", async () => {
		await collection("news", "posts").insertOne({
			title: "No content",
			date: new Date("2024-01-01")
		});

		await expectContractError("/news");
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
	it("returns the number of news posts", async () => {
		await seedNewsPosts();

		const res = await request(app).get("/news/count").expect(200);

		expect(res.body).toEqual({ total: 3 });
	});

	it("returns 0 when there are no news posts", async () => {
		const res = await request(app).get("/news/count").expect(200);

		expect(res.body).toEqual({ total: 0 });
	});
});
