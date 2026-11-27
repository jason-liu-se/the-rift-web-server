import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../test/database.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

describe("indexes built on connect", () => {
	it("keeps map seasons unique", async () => {
		const seasons = collection("maps", "seasons");
		await seasons.insertOne({ season: 5 });

		await expect(seasons.insertOne({ season: 5 })).rejects.toMatchObject({
			code: 11000
		});
	});

	it("keeps createId unique, but only where it's set", async () => {
		const images = collection("gallery", "images");
		await images.insertMany([{ caption: "a" }, { caption: "b" }]);
		await images.insertOne({ caption: "c", createId: "x" });

		await expect(
			images.insertOne({ caption: "d", createId: "x" })
		).rejects.toMatchObject({ code: 11000 });
	});
});
