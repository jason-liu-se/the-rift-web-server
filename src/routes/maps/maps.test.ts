import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Types } from "mongoose";
import { app } from "../../../test/app.ts";
import {
	clearDatabase,
	collection,
	startDatabase,
	stopDatabase
} from "../../../test/database.ts";
import { expectContractError, withId } from "../../../test/responses.ts";

beforeAll(startDatabase);
afterEach(clearDatabase);
afterAll(stopDatabase);

function season(number: number) {
	return {
		_id: new Types.ObjectId(),
		season: number,
		imageUrl: `season-${number}.webp`,
		dimensions: [
			{
				name: "overworld",
				imageUrl: `season-${number}-overworld.webp`,
				worldId: `season-${number}-overworld`,
				perspective: ":0:0:0:1500:0:0:0:0:"
			}
		]
	};
}

describe("GET /maps/seasons", () => {
	it("returns every season, oldest first", async () => {
		const season7 = season(7);
		const season5 = season(5);
		await collection("maps", "seasons").insertMany([
			{ ...season7 },
			{ ...season5 }
		]);

		const res = await request(app).get("/maps/seasons").expect(200);

		// toEqual: only the contract's fields, with _id as id and no __v
		expect(res.body).toEqual([withId(season5), withId(season7)]);
	});

	it("leaves out hidden seasons", async () => {
		const season5 = season(5);
		await collection("maps", "seasons").insertMany([
			{ ...season5 },
			{ ...season(6), visible: false }
		]);

		const res = await request(app).get("/maps/seasons").expect(200);

		expect(res.body).toEqual([withId(season5)]);
	});

	it("returns a season without an image", async () => {
		const season5 = season(5);
		const seasons = collection("maps", "seasons");
		await seasons.insertOne({ ...season5 });
		await seasons.updateOne({}, { $unset: { imageUrl: "" } });

		const res = await request(app).get("/maps/seasons").expect(200);

		// toEqual: an undefined property counts as missing
		expect(res.body).toEqual([{ ...withId(season5), imageUrl: undefined }]);
	});

	it("returns an empty list when there are no seasons", async () => {
		const res = await request(app).get("/maps/seasons").expect(200);

		expect(res.body).toEqual([]);
	});

	it("answers 500 when a stored season breaks the contract", async () => {
		await collection("maps", "seasons").insertOne({
			...season(7),
			dimensions: [{ name: "nether" }]
		});

		await expectContractError("/maps/seasons");
	});
});
