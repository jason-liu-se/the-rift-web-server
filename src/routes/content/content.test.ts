import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi
} from "vitest";
import request from "supertest";
import * as mongoManager from "../../managers/mongo-manager.ts";
import { app } from "../../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { expectContractError } from "../../../test/responses.ts";

beforeAll(startDatabase);
afterEach(async () => {
	vi.useRealTimers();
	await clearDatabase();
});
afterAll(stopDatabase);

const NOW = new Date("2026-01-01T00:00:00.000Z");

function seedVersion(version: unknown) {
	return collection("content", "meta").insertOne({
		// The raw driver types _id as an ObjectId; MongoDB takes any value.
		_id: "contentVersion" as never,
		version
	});
}

describe("GET /content/version", () => {
	it("returns the stored version, never cached", async () => {
		await seedVersion(1763500000000);

		const res = await request(app).get("/content/version").expect(200);

		expect(res.body).toEqual({ version: 1763500000000 });
		expect(res.headers["cache-control"]).toBe("no-store");
		expect(res.headers).not.toHaveProperty("cdn-cache-control");
	});

	it("creates the version with the current time when it's missing", async () => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

		const first = await request(app).get("/content/version").expect(200);
		vi.setSystemTime(NOW.getTime() + 1000);
		const second = await request(app).get("/content/version").expect(200);

		expect(first.body).toEqual({ version: NOW.getTime() });
		expect(second.body).toEqual(first.body);
	});

	it("answers 500 when the stored version isn't a number", async () => {
		await seedVersion("not a number");

		await expectContractError("/content/version");
	});
});

describe("updateContentVersion", () => {
	it("sets the version to the current time and returns it", async () => {
		await seedVersion(1);
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

		const version = await mongoManager.updateContentVersion();

		expect(version).toBe(NOW.getTime());
		await request(app)
			.get("/content/version")
			.expect(200, { version: NOW.getTime() });
	});

	it("creates the version when it's missing", async () => {
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

		expect(await mongoManager.updateContentVersion()).toBe(NOW.getTime());
	});

	it("always changes it, even within a millisecond or after a later hand-set value", async () => {
		const future = NOW.getTime() + 60_000;
		await seedVersion(future);
		vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

		const first = await mongoManager.updateContentVersion();
		const second = await mongoManager.updateContentVersion();

		expect([first, second]).toEqual([future + 1, future + 2]);
	});
});

describe("GET /content/version/:area", () => {
	const PAST = new Date("2025-01-01T00:00:00.000Z");
	const OLDER = new Date("2024-01-01T00:00:00.000Z");

	function seedPost(fields: object) {
		return collection("news", "posts").insertOne({
			title: "t",
			content: "c",
			...fields
		});
	}

	async function newsVersion(): Promise<string> {
		const res = await request(app).get("/content/version/news").expect(200);
		expect(res.headers["cache-control"]).toBe("no-store");
		return res.body.version;
	}

	it("is 0-0 for news when no post is public", async () => {
		expect(await newsVersion()).toBe("0-0");
	});

	it("is the newest public post's date and revision", async () => {
		await Promise.all([
			seedPost({ date: PAST, revision: 3 }),
			seedPost({ date: OLDER, revision: 9 })
		]);

		expect(await newsVersion()).toBe(`${PAST.getTime()}-3`);
	});

	it("counts a missing revision as 0", async () => {
		await seedPost({ date: PAST });

		expect(await newsVersion()).toBe(`${PAST.getTime()}-0`);
	});

	it("skips hidden and scheduled posts for the next newest public one", async () => {
		await Promise.all([
			seedPost({ date: OLDER, revision: 1 }),
			seedPost({ date: PAST, revision: 2, visible: false }),
			seedPost({ date: new Date(Date.now() + 60_000), revision: 1 })
		]);

		expect(await newsVersion()).toBe(`${OLDER.getTime()}-1`);
	});

	it("changes when a scheduled post goes live, without a write", async () => {
		const soon = new Date(Date.now() + 60_000);
		await Promise.all([
			seedPost({ date: OLDER, revision: 1 }),
			seedPost({ date: soon, revision: 1 })
		]);
		expect(await newsVersion()).toBe(`${OLDER.getTime()}-1`);

		// Only Date: MongoDB's driver still needs real timers.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 120_000);

		expect(await newsVersion()).toBe(`${soon.getTime()}-1`);
	});

	it("goes back to the next newest post when the newest is deleted", async () => {
		await seedPost({ date: OLDER, revision: 1 });
		const { insertedId } = await seedPost({ date: PAST, revision: 1 });
		expect(await newsVersion()).toBe(`${PAST.getTime()}-1`);

		await collection("news", "posts").deleteOne({ _id: insertedId });

		expect(await newsVersion()).toBe(`${OLDER.getTime()}-1`);
	});

	it("goes back to the next newest post when the newest moves later", async () => {
		await seedPost({ date: OLDER, revision: 1 });
		const { insertedId } = await seedPost({ date: PAST, revision: 1 });

		await collection("news", "posts").updateOne(
			{ _id: insertedId },
			{ $set: { date: new Date(Date.now() + 60_000), revision: 2 } }
		);

		expect(await newsVersion()).toBe(`${OLDER.getTime()}-1`);
	});

	it.each(["gallery", "constructor", "__proto__"])(
		"answers 404 for an unknown area (%s)",
		async (area) => {
			const res = await request(app)
				.get(`/content/version/${area}`)
				.expect(404);

			expect(res.body).toEqual({
				error: `ERROR: detail version area '${area}' not found`
			});
		}
	);
});
