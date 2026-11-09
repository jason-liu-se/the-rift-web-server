import mongoose, { type HydratedDocument } from "mongoose";
import * as gallerySchema from "../models/gallery-schema.ts";
import * as newsSchema from "../models/news-schema.ts";
import * as downloadsSchema from "../models/downloads-schema.ts";

// MongoDB treats a limit of 0 as "no limit".
const NO_LIMIT = 0;

export interface DownloadCollection {
	name: string;
	items: HydratedDocument<downloadsSchema.DownloadItem>[] | undefined;
}

// Resolves once MongoDB is reachable; rejects if it can't connect, so callers
// don't serve requests without a database.
export async function connect(connectionString: string) {
	mongoose.pluralize(null);
	mongoose.set("autoCreate", false);

	await mongoose.connect(connectionString);
	console.log("Connected to MongoDB");
}

// Omitting `limit` returns every image from `startIndex` onwards.
export async function getGalleryCollection(
	collectionName: string,
	startIndex: number,
	limit?: number
) {
	try {
		return await gallerySchema
			.getModel(collectionName)
			.find()
			.skip(startIndex)
			.limit(limit ?? NO_LIMIT);
	} catch (error) {
		console.error(
			`ERROR: could not fetch gallery collection '${collectionName}':`,
			error
		);
		return undefined;
	}
}

export async function countGalleryCollectionItems(collectionName: string) {
	try {
		return await gallerySchema.getModel(collectionName).countDocuments();
	} catch (error) {
		console.error(
			`ERROR: could not count gallery collection '${collectionName}':`,
			error
		);
		return undefined;
	}
}

// Returns news items newest first. Omitting `limit` returns every item from
// `startIndex` onwards.
export async function getNewsItems(startIndex: number, limit?: number) {
	try {
		return await newsSchema.model
			.find()
			.sort({ date: -1 })
			.skip(startIndex)
			.limit(limit ?? NO_LIMIT);
	} catch (error) {
		console.error("ERROR: could not fetch news items:", error);
		return undefined;
	}
}

export async function countNewsItems() {
	try {
		return await newsSchema.model.countDocuments();
	} catch (error) {
		console.error("ERROR: could not count news items:", error);
		return undefined;
	}
}

export async function getDownloadCollection(collectionName: string) {
	try {
		return await downloadsSchema.getModel(collectionName).find();
	} catch (error) {
		console.error(
			`ERROR: could not fetch download collection '${collectionName}':`,
			error
		);
		return undefined;
	}
}

// Returns every collection in the downloads database with its items.
export async function getAllDownloadCollections(): Promise<
	DownloadCollection[]
> {
	try {
		const collections = await mongoose.connection
			.useDb("downloads")
			.listCollections();

		return await Promise.all(
			collections.map(async ({ name }) => ({
				name,
				items: await getDownloadCollection(name)
			}))
		);
	} catch (error) {
		console.error(
			"ERROR: could not fetch all of the download collections:",
			error
		);
		return [];
	}
}
