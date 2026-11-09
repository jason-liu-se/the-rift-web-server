// Database access for the routers. Reads return plain objects (`.lean()`), not
// Mongoose documents. Query errors propagate to the caller; the app's error
// handler turns them into 500 responses.
import mongoose from "mongoose";
import {
	downloadsDb,
	getDownloadModel,
	type DownloadItem
} from "../models/downloads-schema.ts";
import {
	getGalleryModel,
	type GalleryImage
} from "../models/gallery-schema.ts";
import { newsItemModel, type NewsItem } from "../models/news-schema.ts";

// MongoDB treats a limit of 0 as "no limit".
const NO_LIMIT = 0;

export interface DownloadCollection {
	readonly name: string;
	readonly items: DownloadItem[];
}

// Resolves once MongoDB is reachable; rejects if it can't connect, so callers
// don't serve requests without a database.
export async function connect(connectionString: string): Promise<void> {
	mongoose.pluralize(null);
	mongoose.set("autoCreate", false);

	await mongoose.connect(connectionString);
	console.log("Connected to MongoDB");
}

export async function disconnect(): Promise<void> {
	await mongoose.disconnect();
	console.log("Disconnected from MongoDB");
}

// Omitting `limit` returns every image from `startIndex` onwards.
export async function getGalleryCollection(
	collectionName: string,
	startIndex: number,
	limit?: number
): Promise<GalleryImage[]> {
	return getGalleryModel(collectionName)
		.find()
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT)
		.lean();
}

export async function countGalleryCollectionItems(
	collectionName: string
): Promise<number> {
	return getGalleryModel(collectionName).countDocuments();
}

// Returns news items newest first. Omitting `limit` returns every item from
// `startIndex` onwards.
export async function getNewsItems(
	startIndex: number,
	limit?: number
): Promise<NewsItem[]> {
	return newsItemModel
		.find()
		.sort({ date: -1 })
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT)
		.lean();
}

export async function countNewsItems(): Promise<number> {
	return newsItemModel.countDocuments();
}

export async function getDownloadCollection(
	collectionName: string
): Promise<DownloadItem[]> {
	return getDownloadModel(collectionName).find().lean();
}

// Returns every collection in the downloads database with its items.
export async function getAllDownloadCollections(): Promise<
	DownloadCollection[]
> {
	const collections = await downloadsDb.listCollections();

	return Promise.all(
		collections.map(async ({ name }) => ({
			name,
			items: await getDownloadCollection(name)
		}))
	);
}
