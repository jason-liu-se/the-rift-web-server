// Test helpers: run the app against a throwaway in-memory MongoDB.
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import * as mongoManager from "../src/helpers/mongo-manager.ts";
import { downloadsDb } from "../src/models/downloads-schema.ts";
import { galleryDb } from "../src/models/gallery-schema.ts";
import { newsDb } from "../src/models/news-schema.ts";

const DATABASES = [newsDb, galleryDb, downloadsDb];

let server: MongoMemoryServer | undefined;

export async function startDatabase() {
	server = await MongoMemoryServer.create();
	// Connect through the app's own code so its Mongoose settings apply.
	await mongoManager.connect(server.getUri());
}

export async function stopDatabase() {
	await mongoose.disconnect();
	await server?.stop();
}

export async function clearDatabase() {
	await Promise.all(DATABASES.map((db) => db.dropDatabase()));
}

// Raw driver access for seeding, bypassing the app's schemas.
export function collection(database: string, name: string) {
	return mongoose.connection.useDb(database).collection(name);
}
