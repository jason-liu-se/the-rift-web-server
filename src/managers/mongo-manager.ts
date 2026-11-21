// Database access for the routers. Reads return plain objects (`.lean()`), not
// Mongoose documents, with MongoDB's `_id` as a hex string `id` (lean results
// skip Mongoose's `id` virtual). Query errors propagate to the caller; the app's error
// handler turns them into 500 responses.
import mongoose, { type Types } from "mongoose";
import { accessGrantModel } from "../models/access-grant-schema.ts";
import { draftModel } from "../models/draft-schema.ts";
import {
	CONTENT_VERSION_ID,
	contentVersionModel
} from "../models/content-version-schema.ts";
import {
	downloadCollectionModel,
	downloadItemModel,
	type DownloadItem
} from "../models/downloads-schema.ts";
import {
	galleryCollectionModel,
	galleryImageModel,
	type GalleryImage
} from "../models/gallery-schema.ts";
import { mapSeasonModel, type MapSeason } from "../models/map-season-schema.ts";
import { newsPostModel, type NewsPost } from "../models/news-post-schema.ts";

// MongoDB treats a limit of 0 as "no limit".
const NO_LIMIT = 0;

// Every model, for building their indexes (tests drop them with the data).
const MODELS = [
	accessGrantModel,
	contentVersionModel,
	downloadCollectionModel,
	downloadItemModel,
	draftModel,
	galleryCollectionModel,
	galleryImageModel,
	mapSeasonModel,
	newsPostModel
];

export type WithId<T> = T & { readonly id: string };

export interface DownloadCollection {
	readonly name: string;
	readonly title: string;
	readonly items: WithId<DownloadItem>[];
}

function withId<T extends { _id: Types.ObjectId }>({
	_id,
	...fields
}: T): Omit<T, "_id"> & { readonly id: string } {
	return { ...fields, id: _id.toHexString() };
}

// Resolves once MongoDB is reachable and every index is built; rejects
// otherwise, so callers don't serve requests without a database, or without
// the unique indexes writes rely on (a build that fails, e.g. on duplicate
// data, stops the start instead of only being logged).
export async function connect(connectionString: string): Promise<void> {
	mongoose.pluralize(null);
	mongoose.set("autoCreate", false);
	mongoose.set("autoIndex", false);

	await mongoose.connect(connectionString);
	await createIndexes();
	console.log("Connected to MongoDB");
}

export async function disconnect(): Promise<void> {
	await mongoose.disconnect();
	console.log("Disconnected from MongoDB");
}

// Builds every model's indexes and waits for them, e.g. after dropping a
// database.
export async function createIndexes(): Promise<void> {
	await Promise.all(MODELS.map((model) => model.createIndexes()));
}

// Missing `visible` (documents from before the editor tools) counts as
// visible.
const VISIBLE = { visible: { $ne: false } };

// News posts anyone may read: visible, and dated now or earlier (a later date
// is scheduled).
function publicNewsFilter() {
	return { ...VISIBLE, date: { $lte: new Date() } };
}

// A gallery's public images, optionally only those with every tag.
function publicImagesFilter(slug: string, tags: readonly string[]) {
	return {
		collection: slug,
		...VISIBLE,
		...(tags.length > 0 && { tags: { $all: tags } })
	};
}

// Download items in order: by sortOrder, then the items without one by title.
// A plain sort puts missing values first, hence the computed field.
function sortedDownloadItems(match: object) {
	return downloadItemModel.aggregate<DownloadItem & { _id: Types.ObjectId }>([
		{ $match: match },
		{ $addFields: { unordered: { $not: [{ $isNumber: "$sortOrder" }] } } },
		{ $sort: { unordered: 1, sortOrder: 1, title: 1, _id: 1 } },
		{ $unset: "unordered" }
	]);
}

export interface CollectionSummary {
	readonly slug: string;
	readonly title: string;
}

// Hidden and missing collections both answer false, so routes give the same
// 404 for both.
export async function hasPublicGalleryCollection(
	slug: string
): Promise<boolean> {
	return (await galleryCollectionModel.exists({ slug, ...VISIBLE })) !== null;
}

export async function hasPublicDownloadCollection(
	slug: string
): Promise<boolean> {
	return (
		(await downloadCollectionModel.exists({ slug, ...VISIBLE })) !== null
	);
}

// Every visible gallery, sorted by slug. Unpaginated: there's one per gallery,
// not per image.
export async function getPublicGalleryCollections(): Promise<
	CollectionSummary[]
> {
	return galleryCollectionModel
		.find(VISIBLE, { _id: 0, slug: 1, title: 1 })
		.sort({ slug: 1 })
		.lean();
}

// A gallery's public images, newest first (by `_id`, which holds the creation
// time). Omitting `limit` returns every image from `startIndex` onwards.
export async function getPublicGalleryImages(
	slug: string,
	tags: readonly string[],
	startIndex: number,
	limit?: number
): Promise<WithId<GalleryImage>[]> {
	const images = await galleryImageModel
		.find(publicImagesFilter(slug, tags))
		.sort({ _id: -1 })
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT)
		.lean();
	return images.map(withId);
}

export async function countPublicGalleryImages(
	slug: string,
	tags: readonly string[]
): Promise<number> {
	return galleryImageModel.countDocuments(publicImagesFilter(slug, tags));
}

// The tags on a gallery's public images, sorted.
export async function getPublicGalleryTags(slug: string): Promise<string[]> {
	// Read from the tags index, an image without tags would be a null tag.
	const tags = await galleryImageModel.distinct("tags", {
		...publicImagesFilter(slug, []),
		tags: { $type: "string" }
	});
	return tags.toSorted();
}

// Returns public news posts newest first. Omitting `limit` returns every item
// from `startIndex` onwards.
export async function getPublicNewsPosts(
	startIndex: number,
	limit?: number
): Promise<WithId<NewsPost>[]> {
	const items = await newsPostModel
		.find(publicNewsFilter())
		.sort({ date: -1, _id: -1 })
		.skip(startIndex)
		.limit(limit ?? NO_LIMIT)
		.lean();
	return items.map(withId);
}

export async function countPublicNewsPosts(): Promise<number> {
	return newsPostModel.countDocuments(publicNewsFilter());
}

// The news detail version: the date (ms) of the newest public post, or `0`
// when there's none. It changes when a scheduled post goes live
// (which no write records), and when the newest public post is hidden,
// deleted, or moved to a future date (it then comes from the next newest).
export async function getNewsDetailVersion(): Promise<string> {
	const newest = await newsPostModel
		.findOne(publicNewsFilter(), { date: 1 })
		.sort({ date: -1, _id: -1 })
		.lean();
	return newest ? String(newest.date.getTime()) : "0";
}

// A download collection's public items, in order.
export async function getPublicDownloadItems(
	slug: string
): Promise<WithId<DownloadItem>[]> {
	const items = await sortedDownloadItems({ collection: slug, ...VISIBLE });
	return items.map(withId);
}

// Every visible download collection with its public items, sorted by slug:
// two queries, grouped here.
export async function getPublicDownloadCollections(): Promise<
	DownloadCollection[]
> {
	const [collections, items] = await Promise.all([
		downloadCollectionModel
			.find(VISIBLE, { _id: 0, slug: 1, title: 1 })
			.sort({ slug: 1 })
			.lean(),
		sortedDownloadItems(VISIBLE)
	]);
	// Items of hidden collections have no entry, so they're left out.
	const itemsBySlug = Map.groupBy(items, (item) => item.collection);

	return collections.map(({ slug, title }) => ({
		name: slug,
		title,
		items: (itemsBySlug.get(slug) ?? []).map(withId)
	}));
}

// Returns every visible map season, oldest first. Unpaginated: there's one per
// season.
export async function getPublicMapSeasons(): Promise<WithId<MapSeason>[]> {
	const seasons = await mapSeasonModel
		.find(VISIBLE)
		.sort({ season: 1 })
		.lean();
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
