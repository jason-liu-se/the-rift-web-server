// Database access for the routers. Query errors propagate to the caller; the
// app's error handler turns them into 500 responses.
import mongoose, { type HydratedDocument } from "mongoose";
import * as gallerySchema from "../models/gallery-schema.ts";
import * as newsSchema from "../models/news-schema.ts";
import * as downloadsSchema from "../models/downloads-schema.ts";

// MongoDB treats a limit of 0 as "no limit".
const NO_LIMIT = 0;

export interface DownloadCollection {
	name: string;
	items: HydratedDocument<downloadsSchema.DownloadItem>[];
}

// Resolves once MongoDB is reachable; rejects if it can't connect, so callers
// don't serve requests without a database.
export async function connect(connectionString: string) {
	mongoose.pluralize(null);
	mongoose.set("autoCreate", false);

	await mongoose.connect(connectionString);
	console.log("Connected to MongoDB");
}

export async function disconnect() {
	await mongoose.disconnect();
	console.log("Disconnected from MongoDB");
}

// Omitting `limit` returns every image from `startIndex` onwards.
export async function getGalleryCollection(
	collectionName: string,
	startIndex: number,
	limit?: number
) {
	return gallerySchema
		.getModel(collectionName)
		.find()
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT);
}

export async function countGalleryCollectionItems(collectionName: string) {
	return gallerySchema.getModel(collectionName).countDocuments();
}

// Returns news items newest first. Omitting `limit` returns every item from
// `startIndex` onwards.
export async function getNewsItems(startIndex: number, limit?: number) {
	return newsSchema.model
		.find()
		.sort({ date: -1 })
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT);
}

export async function countNewsItems() {
	return newsSchema.model.countDocuments();
}

export async function getDownloadCollection(collectionName: string) {
	return downloadsSchema.getModel(collectionName).find();
}

// Returns every collection in the downloads database with its items.
export async function getAllDownloadCollections(): Promise<
	DownloadCollection[]
> {
	const collections = await mongoose.connection
		.useDb("downloads")
		.listCollections();

	return Promise.all(
		collections.map(async ({ name }) => ({
			name,
			items: await getDownloadCollection(name)
		}))
	);
}
