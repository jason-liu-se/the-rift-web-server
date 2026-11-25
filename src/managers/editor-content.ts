// Database access for the editor tools: every item, public or not, with its
// computed status. Like mongo-manager (which keeps the public reads), reads
// are plain objects with `_id` as the hex string `id`. One descriptor per
// content type (CONTENT_TYPES) holds what differs, so each query is written
// once.
import { Document, mongo } from "mongoose";
import type { Model, PipelineStage } from "mongoose";
import type { NewsStatus } from "../contract/api-responses.ts";
import type { EditorRef } from "../models/audit-fields.ts";
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
import { DOWNLOAD_ITEM_ORDER } from "./mongo-manager.ts";
import {
	DUPLICATE_KEY,
	LIVE_OR_HIDDEN,
	NEWS_STATUSES,
	duplicateOf,
	isDuplicateKeyError,
	listFilter,
	revisionFilter,
	searchPattern,
	sortByFields,
	staleOutcome,
	tagsMatching,
	textSearch,
	toEditorItem,
	uniqueFieldsOf,
	updateOperators,
	withoutNulls
} from "../helpers/editor-queries.ts";
import type {
	ContentType,
	ContentTypeName,
	CreateResult,
	Duplicate,
	EditorItem,
	EditorListQuery,
	ItemRef,
	ItemUpdate,
	NewItem,
	Rejected,
	StoredItem,
	WriteOp,
	WriteResult
} from "../types/editor-content.ts";

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
		sort: DOWNLOAD_ITEM_ORDER,
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

// A page of a type's items, public or not, with the number matching. As the
// type's summaries: see getItem for whole items.
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

	// The public order sorts right after $match, where an index can serve it;
	// sorted fields sort after the summary, so computed ones (a map's
	// dimensionCount) sort too.
	const ordered =
		query.sort.length === 0
			? [...type.sort, ...page, ...type.summary]
			: [...type.summary, ...sortByFields(query), ...page];
	const [items, total] = await Promise.all([
		type.model.aggregate<StoredItem>([{ $match: filter }, ...ordered]),
		type.model.countDocuments(filter)
	]);
	return { items: items.map((item) => toEditorItem(type, item, now)), total };
}

// The tags on every gallery image, public or not, containing `query`
// (case-insensitive; empty is every tag), sorted.
export async function getGalleryTags(query: string): Promise<string[]> {
	const tags = await galleryImageModel.aggregate<{ _id: string }>(
		tagsMatching("tags", searchPattern(query))
	);
	return tags.map(({ _id }) => _id);
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

// Writes. Every update and delete names the revision the editor started from
// (a missing revision counts as 0): a stale one is a conflict, never a lost
// update. Each write takes many items and does the same few queries however
// many there are (a single write is a batch of one), returning a result per
// item, in order, rather than throwing, so a bulk action can report every
// item's outcome; routes turn one into a status.

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

// Why the insert refused each of these items as a duplicate key: its
// createId already made an item (a repeat, which returns that item), or
// another item holds one of its unique values (a season). Neither means the
// createId's item was deleted since the insert met it, so it's not found.
// Insert errors name the index only in their message, so taken values are
// looked up instead: one query per unique field, if any.
async function explainDuplicates(
	typeName: ContentTypeName,
	items: readonly NewItem[],
	now: Date
): Promise<Map<string, CreateResult>> {
	const type = CONTENT_TYPES[typeName];
	const createdDocs = await findCreated(
		typeName,
		items.map(({ createId }) => createId),
		now
	);
	const unexplained = items.filter(
		({ createId }) => !createdDocs.has(createId)
	);
	const fields = unexplained.length > 0 ? uniqueFieldsOf(type) : [];
	const taken = await Promise.all(
		fields.map(async (field) => {
			const values = unexplained.map((item) => item.fields[field]);
			const found: unknown[] = await type.model.distinct(field, {
				[field]: { $in: values }
			});
			return { field, found };
		})
	);
	const explain = ({ createId, fields: values }: NewItem): CreateResult => {
		const repeat = createdDocs.get(createId);
		if (repeat) {
			return repeat;
		}
		const takenField = taken.find(({ field, found }) =>
			found.includes(values[field])
		)?.field;
		return takenField
			? { outcome: "duplicate", field: takenField }
			: { outcome: "not-found" };
	};
	return new Map(items.map((item) => [item.createId, explain(item)]));
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

	const duplicates = await explainDuplicates(
		typeName,
		items.filter((_item, index) => isDuplicateKeyError(results[index])),
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
		const duplicate =
			isDuplicateKeyError(result) && duplicates.get(createId);
		if (duplicate) {
			return duplicate;
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
