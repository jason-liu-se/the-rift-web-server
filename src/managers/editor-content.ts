// Database access for the editor tools: every item, public or not, with its
// computed status. Like mongo-manager (which keeps the public reads), reads
// are plain objects with `_id` as the hex string `id`. One descriptor per
// content type (CONTENT_TYPES) holds what differs, so each query is written
// once.
import type { Model, PipelineStage, Types } from "mongoose";
import type { ContentStatus } from "../contract/api-responses.ts";
import type { Audited } from "../models/audit-fields.ts";
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
	readonly status: ContentStatus;
};

// A search in one field: `pattern` is the escaped, case-insensitive query.
type SearchField = (pattern: RegExp, query: string) => object;

interface ContentType {
	readonly model: Model<StoredItem>;
	/** The statuses its items can have. */
	readonly statuses: readonly ContentStatus[];
	readonly searchFields: Readonly<Record<string, SearchField>>;
	/** The public order. */
	readonly sort: PipelineStage[];
	/** For gallery and downloads: their collections' metadata. */
	readonly collectionModel?: Model<ContentCollection>;
}

const textSearch =
	(field: string): SearchField =>
	(pattern) => ({ [field]: pattern });

const WITHOUT_SCHEDULE: readonly ContentStatus[] = ["live", "hidden"];

// Models of different documents share these queries; each is cast once here.
function storedItems(model: object): Model<StoredItem> {
	return model as Model<StoredItem>;
}

export const CONTENT_TYPES: Readonly<Record<ContentTypeName, ContentType>> = {
	news: {
		model: storedItems(newsPostModel),
		statuses: ["live", "scheduled", "hidden"],
		searchFields: {
			title: textSearch("title"),
			content: textSearch("content")
		},
		sort: [{ $sort: { date: -1, _id: -1 } }]
	},
	gallery: {
		model: storedItems(galleryImageModel),
		statuses: WITHOUT_SCHEDULE,
		searchFields: {
			caption: textSearch("caption"),
			tags: textSearch("tags")
		},
		sort: [{ $sort: { _id: -1 } }],
		collectionModel: galleryCollectionModel
	},
	downloads: {
		model: storedItems(downloadItemModel),
		statuses: WITHOUT_SCHEDULE,
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
		collectionModel: downloadCollectionModel
	},
	maps: {
		model: storedItems(mapSeasonModel),
		statuses: WITHOUT_SCHEDULE,
		searchFields: {
			// A season is a number, so only a whole-number query matches it.
			season: (_pattern, query) =>
				/^\d+$/.test(query) ? { season: Number(query) } : { _id: null },
			dimensions: textSearch("dimensions.name")
		},
		sort: [{ $sort: { season: 1 } }]
	}
};

// Missing `visible` (documents from before the editor tools) counts as
// visible.
const VISIBLE = { visible: { $ne: false } };

export function contentStatus(item: StoredItem, now: Date): ContentStatus {
	if (item.visible === false) {
		return "hidden";
	}
	return item.date && item.date > now ? "scheduled" : "live";
}

function statusFilter(status: ContentStatus, now: Date): object {
	switch (status) {
		case "hidden":
			return { visible: false };
		case "scheduled":
			return { ...VISIBLE, date: { $gt: now } };
		case "live":
			// Only news has dates; other items are live whenever visible.
			return { ...VISIBLE, date: { $not: { $gt: now } } };
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface EditorListQuery {
	readonly startIndex: number;
	readonly limit?: number;
	/** Only items created by this Discord user. */
	readonly createdBy?: string;
	readonly status?: ContentStatus;
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
	if (query.createdBy !== undefined) {
		filters.push({ "createdBy.id": query.createdBy });
	}
	if (query.status) {
		filters.push(statusFilter(query.status, now));
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

function toEditorItem({ _id, ...fields }: StoredItem, now: Date): EditorItem {
	return {
		...fields,
		id: _id.toHexString(),
		status: contentStatus({ _id, ...fields }, now)
	};
}

// A page of a type's items, public or not, in the public order, with the
// number matching.
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
			...page
		]),
		type.model.countDocuments(filter)
	]);
	return { items: items.map((item) => toEditorItem(item, now)), total };
}

// One item, public or not, or undefined when there's none.
export async function getItem(
	typeName: ContentTypeName,
	id: string,
	now = new Date()
): Promise<EditorItem | undefined> {
	const item = await CONTENT_TYPES[typeName].model.findById(id).lean();
	return item ? toEditorItem(item as StoredItem, now) : undefined;
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
