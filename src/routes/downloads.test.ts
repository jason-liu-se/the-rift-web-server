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

const MAP = {
	title: "Map",
	desc: "A map",
	downloadUrl: "map.zip",
	backgroundUrl: "map.png"
};
const PACK = {
	title: "Pack",
	desc: "A pack",
	downloadUrl: "pack.zip",
	backgroundUrl: "pack.png"
};

describe("GET /downloads", () => {
	it("returns every collection with its items, sorted by name", async () => {
		await collection("downloads", "packs").insertOne({ ...PACK });
		await collection("downloads", "maps").insertOne({ ...MAP });

		const res = await request(app).get("/downloads").expect(200);

		expect(res.body).toMatchObject([
			{ name: "maps", items: [MAP] },
			{ name: "packs", items: [PACK] }
		]);
	});

	it("returns an empty list when there are no collections", async () => {
		const res = await request(app).get("/downloads").expect(200);

		expect(res.body).toEqual([]);
	});
});

describe("GET /downloads/:collection", () => {
	it("returns the collection's items", async () => {
		await collection("downloads", "maps").insertOne({ ...MAP });

		const res = await request(app).get("/downloads/maps").expect(200);

		expect(res.body).toMatchObject([MAP]);
	});

	it("answers 404 for a collection that doesn't exist", async () => {
		const res = await request(app).get("/downloads/missing").expect(404);

		expect(res.body).toEqual({
			error: "ERROR: download collection 'missing' not found"
		});
	});

	it("rejects an invalid collection name", async () => {
		const res = await request(app).get("/downloads/bad%24name").expect(400);

		expect(res.body.error).toMatch(/collection: invalid collection name/);
	});
});
