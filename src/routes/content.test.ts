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
import * as mongoManager from "../helpers/mongo-manager.ts";
import { app } from "../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";
import { expectContractError } from "../../test/responses.ts";

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
