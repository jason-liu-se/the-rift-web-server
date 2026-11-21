// Database access for the editor tools: every item, public or not, with its
// computed status. Like mongo-manager (which keeps the public reads), reads
// are plain objects with `_id` as the hex string `id`. One descriptor per
// content type (CONTENT_TYPES) holds what differs, so each query is written
// once.
import type { Model, PipelineStage, Types } from "mongoose";
import type { NewsStatus } from "../contract/api-responses.ts";
import type { Audited, EditorRef } from "../models/audit-fields.ts";
import type { ContentCollection } from "../models/content-collection-schema.ts";
import {
	downloadCollectionModel,
	downloadItemModel
} from "../models/downloads-schema.ts";
import {
	galleryCollectionModel,
	galleryImageModel
} from "../models/gallery-schema.ts";
import { mapSeasonModel } from "../models/map-season-schema.ts";
import { newsPostModel } from "../models/news-post-schema.ts";

export const CONTENT_TYPE_NAMES = [
	"news",
	"gallery",
	"downloads",
	"maps"
] as const;

export type ContentTypeName = (typeof CONTENT_TYPE_NAMES)[number];

export type CollectionTypeName = "gallery" | "downloads";

// A stored content document, whatever its type: the fields the shared
// queries use, plus the type's own.
export interface StoredItem extends Audited {
	readonly _id: Types.ObjectId;
	readonly date?: Date;
	readonly collection?: string;
	readonly [field: string]: unknown;
}

export type EditorItem = Omit<StoredItem, "_id"> & {
	readonly id: string;
	readonly status: NewsStatus;
};

// A search in one field: `pattern` is the escaped, case-insensitive query.
type SearchField = (pattern: RegExp, query: string) => object;

interface ContentType {
	readonly model: Model<StoredItem>;
	/** The statuses its items can have, and how each is found. */
	readonly statuses: StatusRules;
	readonly searchFields: Readonly<Record<string, SearchField>>;
	/** The public order. */
	readonly sort: PipelineStage[];
	/** What makes an item a list's summary (only `getItem` sends it whole). */
	readonly summary: PipelineStage[];
	/** For gallery and downloads: their collections' metadata. */
	readonly collectionModel?: Model<ContentCollection>;
}

const textSearch =
	(field: string): SearchField =>
	(pattern) => ({ [field]: pattern });

// Missing `visible` (documents from before the editor tools) counts as
// visible.
const VISIBLE = { visible: { $ne: false } };
const HIDDEN = { visible: false };

interface StatusRules {
	/** An item's status. */
	readonly of: (item: StoredItem, now: Date) => NewsStatus;
	/** The filter for each status the type has (its list's `status`). */
	readonly filters: Readonly<
		Partial<Record<NewsStatus, (now: Date) => object>>
	>;
}

// Every type's but news's: live when visible, else hidden.
const LIVE_OR_HIDDEN: StatusRules = {
	of: (item) => (item.visible === false ? "hidden" : "live"),
	filters: { live: () => VISIBLE, hidden: () => HIDDEN }
};

// News also has `scheduled`: visible, but its date hasn't come.
const NEWS_STATUSES: StatusRules = {
	of: (item, now) => {
		if (item.visible === false) {
			return "hidden";
		}
		return item.date && item.date > now ? "scheduled" : "live";
	},
	filters: {
		live: (now) => ({ ...VISIBLE, date: { $not: { $gt: now } } }),
		scheduled: (now) => ({ ...VISIBLE, date: { $gt: now } }),
		hidden: () => HIDDEN
	}
};

// The statuses a type's list can filter by.
export function statusesOf(typeName: ContentTypeName): NewsStatus[] {
	return Object.keys(
		CONTENT_TYPES[typeName].statuses.filters
	) as NewsStatus[];
}

// Models of different documents share these queries; each is cast once here.
function storedItems(model: object): Model<StoredItem> {
	return model as Model<StoredItem>;
}

export const CONTENT_TYPES: Readonly<Record<ContentTypeName, ContentType>> = {
	news: {
		model: storedItems(newsPostModel),
		statuses: NEWS_STATUSES,
		searchFields: {
			title: textSearch("title"),
			content: textSearch("content")
		},
		sort: [{ $sort: { date: -1, _id: -1 } }],
		summary: [{ $unset: "content" }]
	},
	gallery: {
		model: storedItems(galleryImageModel),
		statuses: LIVE_OR_HIDDEN,
		searchFields: {
			caption: textSearch("caption"),
			tags: textSearch("tags")
		},
		sort: [{ $sort: { _id: -1 } }],
		summary: [],
		collectionModel: galleryCollectionModel
	},
	downloads: {
		model: storedItems(downloadItemModel),
		statuses: LIVE_OR_HIDDEN,
		searchFields: {
			title: textSearch("title"),
			desc: textSearch("desc")
		},
		// By sortOrder, then the items without one by title (a plain sort puts
		// missing values first).
		sort: [
			{
				$addFields: {
					unordered: { $not: [{ $isNumber: "$sortOrder" }] }
				}
			},
			{ $sort: { unordered: 1, sortOrder: 1, title: 1, _id: 1 } },
			{ $unset: "unordered" }
		],
		summary: [{ $unset: "desc" }],
		collectionModel: downloadCollectionModel
	},
	maps: {
		model: storedItems(mapSeasonModel),
		statuses: LIVE_OR_HIDDEN,
		searchFields: {
			// A season is a number, so only a whole-number query matches it.
			season: (_pattern, query) =>
				/^\d+$/.test(query) ? { season: Number(query) } : { _id: null },
			dimensions: textSearch("dimensions.name")
		},
		sort: [{ $sort: { season: 1 } }],
		summary: [
			{
				$set: {
					dimensionCount: { $size: { $ifNull: ["$dimensions", []] } }
				}
			},
			{ $unset: "dimensions" }
		]
	}
};

// A status the type doesn't have is a bug: the list query only takes the
// type's own (statusesOf).
function statusFilter(
	type: ContentType,
	status: NewsStatus,
	now: Date
): object {
	const filter = type.statuses.filters[status];
	if (!filter) {
		throw new Error(`no '${status}' status for this content type`);
	}
	return filter(now);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface EditorListQuery {
	readonly startIndex: number;
	readonly limit?: number;
	/** Only items created by this Discord user (ID or username). */
	readonly createdBy?: string;
	/** Only items last updated by this Discord user (ID or username). */
	readonly lastUpdatedBy?: string;
	readonly status?: NewsStatus;
	readonly collection?: string;
	/** A search, in the fields `searchIn` names (all of the type's if empty). */
	readonly q?: string;
	readonly searchIn: readonly string[];
}

function listFilter(
	type: ContentType,
	query: EditorListQuery,
	now: Date
): object {
	const filters: object[] = [];
	for (const field of ["createdBy", "lastUpdatedBy"] as const) {
		const user = query[field];
		if (user !== undefined) {
			filters.push({
				$or: [
					{ [`${field}.id`]: user },
					{ [`${field}.username`]: user }
				]
			});
		}
	}
	if (query.status) {
		filters.push(statusFilter(type, query.status, now));
	}
	if (query.collection !== undefined) {
		filters.push({ collection: query.collection });
	}
	const { q } = query;
	if (q) {
		const pattern = new RegExp(escapeRegExp(q), "i");
		const fields =
			query.searchIn.length > 0
				? query.searchIn
				: Object.keys(type.searchFields);
		filters.push({
			$or: fields.flatMap((field) => {
				const search = type.searchFields[field];
				return search ? [search(pattern, q)] : [];
			})
		});
	}
	return filters.length > 0 ? { $and: filters } : {};
}

function toEditorItem(
	type: ContentType,
	item: StoredItem,
	now: Date
): EditorItem {
	const { _id, ...fields } = item;
	return {
		...fields,
		id: _id.toHexString(),
		status: type.statuses.of(item, now)
	};
}

// A page of a type's items, public or not, in the public order, with the
// number matching. As the type's summaries: see getItem for whole items.
export async function listItems(
	typeName: ContentTypeName,
	query: EditorListQuery,
	now = new Date()
): Promise<{ items: EditorItem[]; total: number }> {
	const type = CONTENT_TYPES[typeName];
	const filter = listFilter(type, query, now);
	const page: PipelineStage[] = [{ $skip: query.startIndex }];
	if (query.limit !== undefined) {
		page.push({ $limit: query.limit });
	}

	const [items, total] = await Promise.all([
		type.model.aggregate<StoredItem>([
			{ $match: filter },
			...type.sort,
			...page,
			...type.summary
		]),
		type.model.countDocuments(filter)
	]);
	return { items: items.map((item) => toEditorItem(type, item, now)), total };
}

// One item, public or not, or undefined when there's none.
export async function getItem(
	typeName: ContentTypeName,
	id: string,
	now = new Date()
): Promise<EditorItem | undefined> {
	const type = CONTENT_TYPES[typeName];
	const item = await type.model.findById(id).lean();
	return item ? toEditorItem(type, item as StoredItem, now) : undefined;
}

export interface EditorCollectionSummary extends ContentCollection {
	readonly itemCount: number;
}

// Every gallery or download collection, public or not, by slug, with how many
// items each holds (for the delete confirmation).
export async function listCollections(
	typeName: CollectionTypeName
): Promise<EditorCollectionSummary[]> {
	const type = CONTENT_TYPES[typeName];
	const collectionModel = type.collectionModel;
	if (!collectionModel) {
		throw new Error(`${typeName} has no collections`);
	}

	const [collections, counts] = await Promise.all([
		collectionModel.find().sort({ slug: 1 }).lean(),
		type.model.aggregate<{ _id: string; count: number }>([
			{ $group: { _id: "$collection", count: { $sum: 1 } } }
		])
	]);
	const countBySlug = new Map(counts.map(({ _id, count }) => [_id, count]));

	return collections.map((collection) => ({
		...collection,
		itemCount: countBySlug.get(collection.slug) ?? 0
	}));
}

// Writes. Every update and delete names the revision the editor started from
// (a missing revision counts as 0): a stale one is a conflict, never a lost
// update. Each returns a WriteResult rather than throwing, so a bulk action
// can report every item's outcome; routes turn it into a status.

export type WriteResult =
	| { readonly outcome: "ok"; readonly item?: EditorItem }
	| { readonly outcome: "conflict"; readonly current: EditorItem }
	| { readonly outcome: "not-found" }
	| Duplicate;

/** A taken unique value other than `createId`: a slug or a season. */
export interface Duplicate {
	readonly outcome: "duplicate";
	readonly field: string;
}

/** A field set to null is removed (e.g. a news post's `imageUrl`). */
export type FieldChanges = Readonly<Record<string, unknown>>;

// The field a MongoDB duplicate key error is about, or undefined for any
// other error.
function duplicateKeyField(error: unknown): string | undefined {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === 11000 &&
		"keyPattern" in error &&
		typeof error.keyPattern === "object" &&
		error.keyPattern !== null
	) {
		return Object.keys(error.keyPattern)[0];
	}
	return undefined;
}

function revisionFilter(revision: number): object {
	return revision === 0 ? { revision: { $in: [0, null] } } : { revision };
}

// $set for the values, $unset for the nulls.
function updateOperators(
	changes: FieldChanges,
	editor: EditorRef
): Record<string, object> {
	const set: Record<string, unknown> = { lastUpdatedBy: editor };
	const unset: Record<string, ""> = {};
	for (const [field, value] of Object.entries(changes)) {
		if (value === null) {
			unset[field] = "";
		} else if (value !== undefined) {
			set[field] = value;
		}
	}
	return {
		$set: set,
		$inc: { revision: 1 },
		...(Object.keys(unset).length > 0 && { $unset: unset })
	};
}

function withoutNulls(fields: FieldChanges): FieldChanges {
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value != null)
	);
}

export type CreateResult =
	| {
			readonly outcome: "ok";
			readonly item: EditorItem;
			/** False when the createId had already made it (a repeat). */
			readonly created: boolean;
	  }
	| Duplicate;

// Runs a write, turning a duplicate key (other than a repeated createId,
// which callers handle first) into a Duplicate outcome.
async function unlessDuplicate<T>(
	write: () => Promise<T>
): Promise<T | Duplicate> {
	try {
		return await write();
	} catch (error) {
		const field = duplicateKeyField(error);
		if (field && field !== "createId") {
			return { outcome: "duplicate", field };
		}
		throw error;
	}
}

// Creates an item at revision 1, or returns the one its createId already
// made.
export async function createItem(
	typeName: ContentTypeName,
	createId: string,
	fields: FieldChanges,
	editor: EditorRef,
	now = new Date()
): Promise<CreateResult> {
	const type = CONTENT_TYPES[typeName];
	const { model } = type;
	const repeated = async () => {
		const made = await model.findOne({ createId }).lean();
		return made
			? ({
					outcome: "ok",
					item: toEditorItem(type, made as StoredItem, now),
					created: false
				} as const)
			: undefined;
	};
	const existing = await repeated();
	if (existing) {
		return existing;
	}

	try {
		return await unlessDuplicate(async () => {
			const created = await model.create({
				visible: true,
				...withoutNulls(fields),
				createId,
				revision: 1,
				createdBy: editor,
				lastUpdatedBy: editor
			});
			return {
				outcome: "ok",
				item: toEditorItem(type, created.toObject() as StoredItem, now),
				created: true
			} as const;
		});
	} catch (error) {
		// A concurrent repeat of this create won the race.
		const made =
			duplicateKeyField(error) === "createId"
				? await repeated()
				: undefined;
		if (made) {
			return made;
		}
		throw error;
	}
}

// Updates an item from the revision the editor started from. `changesFor`
// computes the changes from the stored item (news dates depend on it), so it
// runs once the revision has matched; the write itself checks the revision
// again, so nothing saved in between is overwritten.
export async function updateItem(
	typeName: ContentTypeName,
	id: string,
	revision: number,
	changesFor: (current: StoredItem) => FieldChanges,
	editor: EditorRef,
	now = new Date()
): Promise<WriteResult> {
	const type = CONTENT_TYPES[typeName];
	const { model } = type;
	const current = await model.findById(id).lean();
	if (!current) {
		return { outcome: "not-found" };
	}
	if ((current.revision ?? 0) !== revision) {
		return {
			outcome: "conflict",
			current: toEditorItem(type, current as StoredItem, now)
		};
	}

	return unlessDuplicate(async () => {
		const updated = await model
			.findOneAndUpdate(
				{ _id: id, ...revisionFilter(revision) },
				updateOperators(changesFor(current as StoredItem), editor),
				{ returnDocument: "after", runValidators: true }
			)
			.lean();
		return updated
			? ({
					outcome: "ok",
					item: toEditorItem(type, updated as StoredItem, now)
				} as const)
			: staleOutcome(typeName, id, now);
	});
}

// Why a revision-checked write matched nothing: deleted, or saved since.
async function staleOutcome(
	typeName: ContentTypeName,
	id: string,
	now: Date
): Promise<WriteResult> {
	const item = await getItem(typeName, id, now);
	return item
		? { outcome: "conflict", current: item }
		: { outcome: "not-found" };
}

export async function deleteItem(
	typeName: ContentTypeName,
	id: string,
	revision: number,
	now = new Date()
): Promise<WriteResult> {
	const { deletedCount } = await CONTENT_TYPES[typeName].model.deleteOne({
		_id: id,
		...revisionFilter(revision)
	});
	return deletedCount === 1
		? { outcome: "ok" }
		: staleOutcome(typeName, id, now);
}

function collectionModelOf(
	typeName: CollectionTypeName
): Model<ContentCollection> {
	const { collectionModel } = CONTENT_TYPES[typeName];
	if (!collectionModel) {
		throw new Error(`${typeName} has no collections`);
	}
	return collectionModel;
}

// Whether a gallery or download collection exists, public or not.
export async function hasCollection(
	typeName: CollectionTypeName,
	slug: string
): Promise<boolean> {
	return (await collectionModelOf(typeName).exists({ slug })) !== null;
}

export type CollectionWriteResult =
	| { readonly outcome: "ok"; readonly collection?: EditorCollectionSummary }
	| Duplicate
	| {
			readonly outcome: "conflict";
			readonly current: EditorCollectionSummary;
	  }
	| { readonly outcome: "not-found" };

async function collectionSummary(
	typeName: CollectionTypeName,
	collection: ContentCollection
): Promise<EditorCollectionSummary> {
	const itemCount = await CONTENT_TYPES[typeName].model.countDocuments({
		collection: collection.slug
	});
	return { ...collection, itemCount };
}

// A Duplicate when the slug is taken.
export async function createCollection(
	typeName: CollectionTypeName,
	fields: { slug: string; title: string; visible?: boolean },
	editor: EditorRef
): Promise<CollectionWriteResult> {
	return unlessDuplicate(async () => {
		const created = await collectionModelOf(typeName).create({
			visible: true,
			...fields,
			revision: 1,
			createdBy: editor,
			lastUpdatedBy: editor
		});
		return {
			outcome: "ok",
			collection: { ...created.toObject(), itemCount: 0 }
		} as const;
	});
}

async function staleCollection(
	typeName: CollectionTypeName,
	slug: string
): Promise<CollectionWriteResult> {
	const current = await collectionModelOf(typeName).findOne({ slug }).lean();
	return current
		? {
				outcome: "conflict",
				current: await collectionSummary(typeName, current)
			}
		: { outcome: "not-found" };
}

export async function updateCollection(
	typeName: CollectionTypeName,
	slug: string,
	revision: number,
	changes: { title?: string; visible?: boolean },
	editor: EditorRef
): Promise<CollectionWriteResult> {
	const updated = await collectionModelOf(typeName)
		.findOneAndUpdate(
			{ slug, ...revisionFilter(revision) },
			updateOperators(changes, editor),
			{ returnDocument: "after" }
		)
		.lean();
	return updated
		? {
				outcome: "ok",
				collection: await collectionSummary(typeName, updated)
			}
		: staleCollection(typeName, slug);
}

// Deletes a collection and every item in it. The collection goes first
// (revision-checked), so a stale delete removes nothing.
export async function deleteCollection(
	typeName: CollectionTypeName,
	slug: string,
	revision: number
): Promise<CollectionWriteResult> {
	const { deletedCount } = await collectionModelOf(typeName).deleteOne({
		slug,
		...revisionFilter(revision)
	});
	if (deletedCount !== 1) {
		return staleCollection(typeName, slug);
	}
	await CONTENT_TYPES[typeName].model.deleteMany({ collection: slug });
	return { outcome: "ok" };
}
