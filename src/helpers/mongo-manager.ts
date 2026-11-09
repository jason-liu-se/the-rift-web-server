import mongoose, { type HydratedDocument } from "mongoose";
import * as gallerySchema from "../models/gallery-schema.ts";
import * as newsSchema from "../models/news-schema.ts";
import * as downloadsSchema from "../models/downloads-schema.ts";

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

// limit = -1 implies that no limit was specified. Assumed all documents are desired
export async function getGalleryCollection(
	collectionName: string,
	startIndex: number,
	limit: number
) {
	const model = gallerySchema.getModel(collectionName);
	let galleryCollection:
		HydratedDocument<gallerySchema.GalleryImage>[] | undefined;

	try {
		if (limit === -1) {
			await model.countDocuments({}).then(async (data) => (limit = data));
		}

		await model
			.find({})
			.skip(startIndex)
			.limit(limit)
			.then(async (data) => {
				galleryCollection = data;
			})
			.catch((e) =>
				console.log(
					"ERROR: could not fetch gallery collection '" +
						collectionName +
						"': ",
					e
				)
			);
	} catch (e) {
		console.log(e);
	}

	return galleryCollection;
}

export async function countGalleryCollectionItems(collectionName: string) {
	const model = gallerySchema.getModel(collectionName);
	let galleryCollectionCount: number | undefined;

	try {
		await model
			.countDocuments({})
			.then(async (data) => {
				galleryCollectionCount = data;
			})
			.catch((e) =>
				console.log(
					"ERROR: could not fetch gallery collection '" +
						collectionName +
						"' count: ",
					e
				)
			);
	} catch (e) {
		console.log(e);
	}

	return galleryCollectionCount;
}

// Pre:
// limit = -1 implies that no limit was specified. Assumed all documents are desired
//
// Post:
// The specified number of news items, starting at the startIndex, are sorted by date (newest to oldest) and returned
export async function getNewsItems(startIndex: number, limit: number) {
	const model = newsSchema.model;
	let newsItems: HydratedDocument<newsSchema.NewsItem>[] | undefined;

	try {
		if (limit === -1) {
			await model.countDocuments({}).then((data) => (limit = data));
		}

		await model
			.find({})
			.sort({ date: -1 })
			.skip(startIndex)
			.limit(limit)
			.then(async (data) => {
				newsItems = data;
			})
			.catch((e) =>
				console.log("ERROR: could not fetch news items: ", e)
			);
	} catch (e) {
		console.log(e);
	}

	return newsItems;
}

export async function countNewsItems() {
	const model = newsSchema.model;
	let count: number | undefined;

	try {
		await model
			.countDocuments({})
			.then(async (data) => {
				count = data;
			})
			.catch((e) =>
				console.log("ERROR: could not fetch news item count.'", e)
			);
	} catch (e) {
		console.log(e);
	}

	return count;
}

export async function getDownloadCollection(collectionName: string) {
	const model = downloadsSchema.getModel(collectionName);
	let downloadCollection:
		HydratedDocument<downloadsSchema.DownloadItem>[] | undefined;

	try {
		await model
			.find({})
			.then(async (data) => {
				downloadCollection = data;
			})
			.catch((e) =>
				console.log(
					"ERROR: could not fetch download collection '" +
						collectionName +
						"': ",
					e
				)
			);
	} catch (e) {
		console.log(e);
	}

	return downloadCollection;
}

export async function getAllDownloadCollections() {
	const db = mongoose.connection.useDb("downloads");
	const collections: DownloadCollection[] = [];

	// getting a list of the collections
	// and formatting each collection with its
	// associated records
	try {
		await db.db
			?.listCollections()
			.toArray()
			.then(async (data) => {
				for (const collection of data) {
					const items = await getDownloadCollection(collection.name);

					collections.push({
						name: collection.name,
						items: items
					});
				}
			});
	} catch (e) {
		console.log(
			"ERROR: could not fetch all of the download collections",
			e
		);
	}

	return collections;
}
