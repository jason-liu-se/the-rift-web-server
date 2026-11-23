// Database access for the editor tools: every item, public or not, with its
// computed status. Like mongo-manager (which keeps the public reads), reads
// are plain objects with `_id` as the hex string `id`. One descriptor per
// content type (CONTENT_TYPES) holds what differs, so each query is written
// once.
import { Document, mongo } from "mongoose";
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
	/** What an item is called in messages. */
	readonly itemName: string;
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
		itemName: "news post",
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
		itemName: "gallery image",
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
		itemName: "download item",
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
		itemName: "map season",
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
// update. Each write takes many items and does the same few queries however
// many there are (a single write is a batch of one), returning a result per
// item, in order, rather than throwing, so a bulk action can report every
// item's outcome; routes turn one into a status.

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

/** An update whose `changesFor` threw (e.g. too many tags): nothing written. */
export interface Rejected {
	readonly outcome: "rejected";
	readonly error: unknown;
}

/** A field set to null is removed (e.g. a news post's `imageUrl`). */
export type FieldChanges = Readonly<Record<string, unknown>>;

/** An item to update or delete, at the revision the editor started from. */
export interface ItemRef {
	readonly id: string;
	readonly startingRevision: number;
}

export interface ItemUpdate extends ItemRef {
	/**
	 * The changes, from the stored item (news dates depend on it). Runs only
	 * once the revision has matched; the write checks it again, so nothing
	 * saved in between is overwritten.
	 */
	readonly changesFor: (current: StoredItem) => FieldChanges;
}

export interface NewItem {
	readonly createId: string;
	readonly fields: FieldChanges;
}

export type CreateResult =
	| {
			readonly outcome: "ok";
			readonly item: EditorItem;
			/** False when the createId had already made it (a repeat). */
			readonly created: boolean;
	  }
	| Duplicate;

const DUPLICATE_KEY = 11000;

// The field a MongoDB duplicate key error is about, or undefined for any
// other error.
function duplicateKeyField(error: unknown): string | undefined {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === DUPLICATE_KEY &&
		"keyPattern" in error &&
		typeof error.keyPattern === "object" &&
		error.keyPattern !== null
	) {
		return Object.keys(error.keyPattern)[0];
	}
	return undefined;
}

// A type's unique fields other than createId, from its schema's indexes
// (a map's season).
function uniqueFieldsOf(type: ContentType): string[] {
	return type.model.schema
		.indexes()
		.filter(([, options]) => options.unique)
		.flatMap(([fields]) => Object.keys(fields))
		.filter((field) => field !== "createId");
}

// Bulk write errors don't name the unique index a duplicate key broke, so
// it's the type's one unique field (createId is told apart by looking it up).
function duplicateOf(type: ContentType): Duplicate {
	const [field, ...others] = uniqueFieldsOf(type);
	if (!field || others.length > 0) {
		throw new Error(
			`duplicate key on a ${type.itemName} without exactly one unique field`
		);
	}
	return { outcome: "duplicate", field };
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

// The stored items among `ids`, by id, in one query.
async function itemsById(
	type: ContentType,
	ids: readonly string[]
): Promise<Map<string, StoredItem>> {
	if (ids.length === 0) {
		return new Map();
	}
	const items = await type.model.find({ _id: { $in: ids } }).lean();
	return new Map(
		items.map((item) => [item._id.toHexString(), item as StoredItem])
	);
}

// Why a revision-checked write matched nothing: deleted, or saved since.
function staleOutcome(
	type: ContentType,
	current: StoredItem | undefined,
	now: Date
): WriteResult {
	return current
		? { outcome: "conflict", current: toEditorItem(type, current, now) }
		: { outcome: "not-found" };
}

type WriteOp =
	| {
			readonly name: "updateOne";
			readonly filter: object;
			readonly update: object;
	  }
	| { readonly name: "deleteOne"; readonly filter: object };

// Runs every op in one unordered bulk write, so one failing op doesn't stop
// the others, returning each op's matched (update) or deleted count, or a
// Duplicate. MongoDB 8.0's client bulk write reports each op's count
// (`verboseResults`), so a stale revision is known exactly; the older
// per-collection bulk write only reports totals.
async function writeEach(
	type: ContentType,
	ops: readonly WriteOp[]
): Promise<(number | Duplicate)[]> {
	if (ops.length === 0) {
		return [];
	}
	const { model } = type;
	let result: mongo.ClientBulkWriteResult | undefined;
	let writeErrors: ReadonlyMap<number, mongo.ClientBulkWriteError> =
		new Map();
	try {
		result = await model.db.bulkWrite(
			ops.map((op) => ({ ...op, model: model.modelName })),
			{ ordered: false, verboseResults: true }
		);
	} catch (error) {
		// Mongoose adds `mongoose` only when it left out ops (below).
		if (
			!(error instanceof mongo.MongoClientBulkWriteError) ||
			error.writeConcernErrors.length > 0 ||
			"mongoose" in error
		) {
			throw error;
		}
		result = error.partialResult;
		writeErrors = error.writeErrors;
	}
	// Mongoose leaves out ops it can't cast and keys the counts by the ops it
	// sent, which would shift every index after them (checked against Mongoose
	// 9.12); the request schemas should have refused them first.
	const [castError] =
		(result as { mongoose?: { validationErrors: Error[] } } | undefined)
			?.mongoose?.validationErrors ?? [];
	if (castError) {
		throw castError;
	}

	return ops.map((op, index) => {
		const writeError = writeErrors.get(index);
		if (writeError) {
			if (writeError.code !== DUPLICATE_KEY) {
				throw new Error(`bulk write failed: ${writeError.message}`);
			}
			return duplicateOf(type);
		}
		const numModified =
			op.name === "updateOne"
				? result?.updateResults?.get(index)?.matchedCount
				: result?.deleteResults?.get(index)?.deletedCount;
		if (numModified === undefined) {
			throw new Error(`bulk write reported nothing for op ${index}`);
		}
		return numModified;
	});
}

// The items creates with these createIds already made, by createId: a repeat
// returns its item rather than making another.
export async function findCreated(
	typeName: ContentTypeName,
	createIds: readonly string[],
	now = new Date()
): Promise<Map<string, Extract<CreateResult, { outcome: "ok" }>>> {
	const type = CONTENT_TYPES[typeName];
	const createdDocs =
		createIds.length > 0
			? await type.model.find({ createId: { $in: createIds } }).lean()
			: [];
	return new Map(
		createdDocs.map((item) => [
			String(item.createId),
			{
				outcome: "ok",
				item: toEditorItem(type, item as StoredItem, now),
				created: false
			}
		])
	);
}

// Creates each item at revision 1 in one unordered insert, or returns the
// one its createId already made (a repeat, or a concurrent repeat that won
// the race). Mongoose makes the ObjectIds in order, so items keep their order
// in `_id` (the gallery's newest-first order).
export async function createItems(
	typeName: ContentTypeName,
	items: readonly NewItem[],
	editor: EditorRef,
	now = new Date()
): Promise<CreateResult[]> {
	const type = CONTENT_TYPES[typeName];
	if (items.length === 0) {
		return [];
	}
	const docs = items.map(({ createId, fields }) => ({
		visible: true,
		...withoutNulls(fields),
		createId,
		revision: 1,
		createdBy: editor,
		lastUpdatedBy: editor
	}));
	let results: readonly unknown[];
	try {
		const inserted = await type.model.insertMany(docs, {
			ordered: false,
			rawResult: true
		});
		results = inserted.mongoose.results;
	} catch (error) {
		// Unordered, it still inserts every item it can, then throws with
		// each item's result.
		const decorated = (error as { mongoose?: { results?: unknown[] } })
			.mongoose?.results;
		if (!decorated) {
			throw error;
		}
		results = decorated;
	}

	// The driver doesn't export its WriteError class.
	const isDuplicate = (result: unknown) =>
		typeof result === "object" &&
		result !== null &&
		"code" in result &&
		result.code === DUPLICATE_KEY;
	const createdDocs = await findCreated(
		typeName,
		items.flatMap(({ createId }, index) =>
			isDuplicate(results[index]) ? [createId] : []
		),
		now
	);
	return items.map(({ createId }, index): CreateResult => {
		const result = results[index];
		if (result instanceof Document) {
			return {
				outcome: "ok",
				item: toEditorItem(type, result.toObject() as StoredItem, now),
				created: true
			};
		}
		if (isDuplicate(result)) {
			return createdDocs.get(createId) ?? duplicateOf(type);
		}
		// A schema validation error, which the request schemas should have
		// caught first, or a failed write.
		throw result instanceof Error ? result : new Error(String(result));
	});
}

// Updates each item from the revision the editor started from: one read for
// the stored items, one bulk write, one read for the results (so a save by
// someone else just after shows in an item's result). The bulk write runs no
// Mongoose update validators: the request schemas are the check.
export async function updateItems(
	typeName: ContentTypeName,
	updates: readonly ItemUpdate[],
	editor: EditorRef,
	now = new Date()
): Promise<(WriteResult | Rejected)[]> {
	const type = CONTENT_TYPES[typeName];
	const stored = await itemsById(
		type,
		updates.map(({ id }) => id)
	);

	interface Pending {
		readonly id: string;
		readonly op: WriteOp;
	}
	const planned = updates.map(
		({
			id,
			startingRevision,
			changesFor
		}): WriteResult | Rejected | Pending => {
			const current = stored.get(id);
			if (!current || (current.revision ?? 0) !== startingRevision) {
				return staleOutcome(type, current, now);
			}
			try {
				const update = updateOperators(changesFor(current), editor);
				return {
					id,
					op: {
						name: "updateOne",
						filter: {
							_id: id,
							...revisionFilter(startingRevision)
						},
						update
					}
				};
			} catch (error) {
				return { outcome: "rejected", error };
			}
		}
	);

	const pending = planned.filter((plan) => "op" in plan);
	const outcomes = await writeEach(
		type,
		pending.map(({ op }) => op)
	);
	const written = await itemsById(
		type,
		pending.map(({ id }) => id)
	);
	let pendingIndex = 0;
	return planned.map((plan) => {
		if (!("op" in plan)) {
			return plan;
		}
		const outcome = outcomes[pendingIndex++];
		const after = written.get(plan.id);
		if (typeof outcome === "object") {
			return outcome;
		}
		return outcome === 1 && after
			? { outcome: "ok", item: toEditorItem(type, after, now) }
			: staleOutcome(type, after, now);
	});
}

// Deletes each item at the revision the editor started from: one bulk write,
// and one read to tell a stale item from a missing one.
export async function deleteItems(
	typeName: ContentTypeName,
	refs: readonly ItemRef[],
	now = new Date()
): Promise<WriteResult[]> {
	const type = CONTENT_TYPES[typeName];
	const deleted = await writeEach(
		type,
		refs.map(({ id, startingRevision }) => ({
			name: "deleteOne",
			filter: { _id: id, ...revisionFilter(startingRevision) }
		}))
	);
	const remaining = await itemsById(
		type,
		refs.flatMap(({ id }, index) => (deleted[index] === 1 ? [] : [id]))
	);
	return refs.map(({ id }, index) =>
		deleted[index] === 1
			? { outcome: "ok" }
			: staleOutcome(type, remaining.get(id), now)
	);
}

// One item's write, as a batch of one.
function onlyResult<T>(results: readonly T[]): T {
	const [result] = results;
	if (result === undefined || results.length !== 1) {
		throw new Error("expected one write result");
	}
	return result;
}

export async function createItem(
	typeName: ContentTypeName,
	createId: string,
	fields: FieldChanges,
	editor: EditorRef,
	now = new Date()
): Promise<CreateResult> {
	return onlyResult(
		await createItems(typeName, [{ createId, fields }], editor, now)
	);
}

// Throws whatever `changesFor` threw.
export async function updateItem(
	typeName: ContentTypeName,
	id: string,
	startingRevision: number,
	changesFor: (current: StoredItem) => FieldChanges,
	editor: EditorRef,
	now = new Date()
): Promise<WriteResult> {
	const result = onlyResult(
		await updateItems(
			typeName,
			[{ id, startingRevision, changesFor }],
			editor,
			now
		)
	);
	if (result.outcome === "rejected") {
		throw result.error;
	}
	return result;
}

export async function deleteItem(
	typeName: ContentTypeName,
	id: string,
	startingRevision: number,
	now = new Date()
): Promise<WriteResult> {
	return onlyResult(
		await deleteItems(typeName, [{ id, startingRevision }], now)
	);
}

// Runs a collection write, turning a duplicate key into a Duplicate outcome.
async function unlessDuplicate<T>(
	write: () => Promise<T>
): Promise<T | Duplicate> {
	try {
		return await write();
	} catch (error) {
		const field = duplicateKeyField(error);
		if (field) {
			return { outcome: "duplicate", field };
		}
		throw error;
	}
}

function collectionModelOf(
	typeName: ContentTypeName
): Model<ContentCollection> {
	const { collectionModel } = CONTENT_TYPES[typeName];
	if (!collectionModel) {
		throw new Error(`${typeName} has no collections`);
	}
	return collectionModel;
}

// Whether a gallery or download collection exists, public or not.
export async function hasCollection(
	typeName: ContentTypeName,
	slug: string
): Promise<boolean> {
	return (await collectionModelOf(typeName).exists({ slug })) !== null;
}

// Every slug in `slugs` that names no collection.
export async function missingCollections(
	typeName: CollectionTypeName,
	slugs: readonly string[]
): Promise<string[]> {
	const found = await collectionModelOf(typeName).distinct("slug", {
		slug: { $in: slugs }
	});
	return slugs.filter((slug) => !found.includes(slug));
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
	// The items go first, so if the server stops between the two deletes the
	// collection is still there to delete again, rather than its items left
	// behind for a new collection of the same slug to take over.
	const collection = collectionModelOf(typeName);
	const filter = { slug, ...revisionFilter(revision) };
	if ((await collection.exists(filter)) === null) {
		return staleCollection(typeName, slug);
	}
	await CONTENT_TYPES[typeName].model.deleteMany({ collection: slug });
	const { deletedCount } = await collection.deleteOne(filter);
	return deletedCount === 1
		? { outcome: "ok" }
		: staleCollection(typeName, slug);
}
