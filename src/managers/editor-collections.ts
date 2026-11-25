import type { Model } from "mongoose";
import type { EditorRef } from "../models/audit-fields.ts";
import type { ContentCollection } from "../models/content-collection-schema.ts";
import {
	duplicateKeyField,
	revisionFilter,
	updateOperators
} from "../helpers/editor-queries.ts";
import type {
	CollectionTypeName,
	CollectionWriteResult,
	ContentTypeName,
	Duplicate,
	EditorCollectionSummary
} from "../types/editor-content.ts";
import { CONTENT_TYPES } from "./editor-content.ts";

// Every gallery or download collection, public or not, by slug, with how many
// items each holds (for the delete confirmation).
export async function listCollections(
	typeName: CollectionTypeName
): Promise<EditorCollectionSummary[]> {
	const [collections, counts] = await Promise.all([
		collectionModelOf(typeName).find().sort({ slug: 1 }).lean(),
		CONTENT_TYPES[typeName].model.aggregate<{ _id: string; count: number }>(
			[{ $group: { _id: "$collection", count: { $sum: 1 } } }]
		)
	]);
	const countBySlug = new Map(counts.map(({ _id, count }) => [_id, count]));

	return collections.map((collection) => ({
		...collection,
		itemCount: countBySlug.get(collection.slug) ?? 0
	}));
}

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

// Every slug in `slugs` that names no collection, public or not (none for a
// type without collections).
export async function missingCollections(
	typeName: ContentTypeName,
	slugs: readonly string[]
): Promise<string[]> {
	if (slugs.length === 0 || !CONTENT_TYPES[typeName].collectionModel) {
		return [];
	}
	const found = await collectionModelOf(typeName).distinct("slug", {
		slug: { $in: slugs }
	});
	return slugs.filter((slug) => !found.includes(slug));
}

/** Deletes the items among `ids` that are still in one of `slugs`. */
export async function deleteItemsInCollections(
	typeName: ContentTypeName,
	ids: readonly string[],
	slugs: readonly string[]
): Promise<void> {
	await CONTENT_TYPES[typeName].model.deleteMany({
		_id: { $in: ids },
		collection: { $in: slugs }
	});
}

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
	fields: Pick<ContentCollection, "slug" | "title" | "dimensions"> & {
		visible?: boolean;
	},
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
	changes: Partial<
		Pick<ContentCollection, "title" | "dimensions" | "visible">
	>,
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

// The revision goes up first, so a save racing the delete gets 409. Items go
// before the collection, so a delete that stops midway can be repeated, and
// again after it, for any written in between (see editor-writes).
export async function deleteCollection(
	typeName: CollectionTypeName,
	slug: string,
	revision: number
): Promise<CollectionWriteResult> {
	const collection = collectionModelOf(typeName);
	const { matchedCount } = await collection.updateOne(
		{ slug, ...revisionFilter(revision) },
		{ $inc: { revision: 1 } }
	);
	if (matchedCount === 0) {
		return staleCollection(typeName, slug);
	}
	const { model } = CONTENT_TYPES[typeName];
	await model.deleteMany({ collection: slug });
	await collection.deleteOne({ slug });
	await model.deleteMany({ collection: slug });
	return { outcome: "ok" };
}
