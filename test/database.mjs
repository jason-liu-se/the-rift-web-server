// Test helpers: run the app against a throwaway in-memory MongoDB.
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import mongoManager from "../helpers/mongo-manager.js";

const DATABASES = ["news", "gallery", "downloads"];

let server;

export async function startDatabase() {
	server = await MongoMemoryServer.create();
	process.env.MONGODB_CONNECTION_STRING = server.getUri();
	// Connect through the app's own code so its Mongoose settings apply.
	mongoManager.connect();
	await mongoose.connection.asPromise();
}

export async function stopDatabase() {
	await mongoose.disconnect();
	await server.stop();
}

export async function clearDatabase() {
	await Promise.all(
		DATABASES.map((name) => mongoose.connection.useDb(name).dropDatabase())
	);
}

// Raw driver access for seeding, bypassing the app's schemas.
export function collection(database, name) {
	return mongoose.connection.useDb(database).collection(name);
}
