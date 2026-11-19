// Database access for the routers. Reads return plain objects (`.lean()`), not
// Mongoose documents, with MongoDB's `_id` as a hex string `id` (lean results
// skip Mongoose's `id` virtual). Query errors propagate to the caller; the app's error
// handler turns them into 500 responses.
import mongoose, { type Connection, type Types } from "mongoose";
import { accessGrantModel } from "../models/access-grant-schema.ts";
import {
	CONTENT_VERSION_ID,
	contentVersionModel
} from "../models/content-version-schema.ts";
import {
	downloadsDb,
	getDownloadModel,
	type DownloadItem
} from "../models/downloads-schema.ts";
import {
	galleryDb,
	getGalleryModel,
	type GalleryImage
} from "../models/gallery-schema.ts";
import { mapSeasonModel, type MapSeason } from "../models/map-season-schema.ts";
import { newsPostModel, type NewsPost } from "../models/news-post-schema.ts";

// MongoDB treats a limit of 0 as "no limit".
const NO_LIMIT = 0;

export type WithId<T> = T & { readonly id: string };

export interface DownloadCollection {
	readonly name: string;
	readonly items: WithId<DownloadItem>[];
}

function withId<T extends { _id: Types.ObjectId }>({
	_id,
	...fields
}: T): Omit<T, "_id"> & { readonly id: string } {
	return { ...fields, id: _id.toHexString() };
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

// Sorted by name: MongoDB lists collections in no guaranteed order.
async function listCollectionNames(db: Connection): Promise<string[]> {
	const collections = await db.listCollections();
	return collections.map(({ name }) => name).toSorted();
}

async function hasCollection(
	db: Connection,
	collectionName: string
): Promise<boolean> {
	const names = await listCollectionNames(db);
	return names.includes(collectionName);
}

// Collections are never auto-created, so a query against a missing one just
// returns nothing; these let routes answer 404 instead.
export async function hasGalleryCollection(
	collectionName: string
): Promise<boolean> {
	return hasCollection(galleryDb, collectionName);
}

export async function hasDownloadCollection(
	collectionName: string
): Promise<boolean> {
	return hasCollection(downloadsDb, collectionName);
}

// Every gallery's name, sorted. Unpaginated: there's one per gallery, not per
// image.
export async function getGalleryCollectionNames(): Promise<string[]> {
	return listCollectionNames(galleryDb);
}

// Omitting `limit` returns every image from `startIndex` onwards.
export async function getGalleryCollection(
	collectionName: string,
	startIndex: number,
	limit?: number
): Promise<WithId<GalleryImage>[]> {
	const images = await getGalleryModel(collectionName)
		.find()
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT)
		.lean();
	return images.map(withId);
}

export async function countGalleryCollectionItems(
	collectionName: string
): Promise<number> {
	return getGalleryModel(collectionName).countDocuments();
}

// Returns news posts newest first. Omitting `limit` returns every item from
// `startIndex` onwards.
export async function getNewsPosts(
	startIndex: number,
	limit?: number
): Promise<WithId<NewsPost>[]> {
	const items = await newsPostModel
		.find()
		.sort({ date: -1 })
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT)
		.lean();
	return items.map(withId);
}

export async function countNewsPosts(): Promise<number> {
	return newsPostModel.countDocuments();
}

export async function getDownloadCollection(
	collectionName: string
): Promise<WithId<DownloadItem>[]> {
	const items = await getDownloadModel(collectionName).find().lean();
	return items.map(withId);
}

// Returns every collection in the downloads database with its items, sorted by
// name.
export async function getAllDownloadCollections(): Promise<
	DownloadCollection[]
> {
	const names = await listCollectionNames(downloadsDb);

	return Promise.all(
		names.map(async (name) => ({
			name,
			items: await getDownloadCollection(name)
		}))
	);
}

// Returns every map season, oldest first. Unpaginated: there's one per season.
export async function getMapSeasons(): Promise<WithId<MapSeason>[]> {
	const seasons = await mapSeasonModel.find().sort({ season: 1 }).lean();
	return seasons.map(withId);
}

// The current content version. Creates it with the current time if it's
// missing (first run, or deleted by hand): an upsert that only inserts, so
// concurrent first reads agree on one value.
export async function getContentVersion(): Promise<number> {
	const stored = await contentVersionModel
		.findById(CONTENT_VERSION_ID)
		.lean();
	if (stored) {
		return stored.version;
	}

	const { version } = await contentVersionModel
		.findOneAndUpdate(
			{ _id: CONTENT_VERSION_ID },
			{ $setOnInsert: { version: Date.now() } },
			{ upsert: true, returnDocument: "after" }
		)
		.orFail()
		.lean();
	return version;
}

// Changes the content version, so public reads get new cache entries, and
// returns it. Call it only once a write has committed: bumped first, a read in
// between could cache the old content under the new version for a day. The current time, or one more than the current
// version if that's not later (writes in the same millisecond, a clock that
// went back, or a hand-set future value), so it always changes.
export async function updateContentVersion(): Promise<number> {
	const { version } = await contentVersionModel
		.findOneAndUpdate(
			{ _id: CONTENT_VERSION_ID },
			[
				{
					$set: {
						version: {
							$max: [Date.now(), { $add: ["$version", 1] }]
						}
					}
				}
			],
			// Mongoose doesn't cast pipelines, so it only runs them when asked.
			{ upsert: true, returnDocument: "after", updatePipeline: true }
		)
		.orFail()
		.lean();
	return version;
}

export interface AccessGrantSubjects {
	readonly userId: string;
	readonly roleIds: string[];
}

// Whether an access grant matches the user or one of their roles. Entries of
// any other type never match. No grants (or no collection) means nobody can
// log in.
export async function hasAccessGrant({
	userId,
	roleIds
}: AccessGrantSubjects): Promise<boolean> {
	const grant = await accessGrantModel.exists({
		$or: [
			{ subjectType: "user", subjectId: userId },
			{ subjectType: "role", subjectId: { $in: roleIds } }
		]
	});
	return grant !== null;
}
