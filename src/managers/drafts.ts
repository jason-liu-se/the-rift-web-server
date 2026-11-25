// Database access for drafts. Every query is scoped to the owner, so no
// caller can read or change another editor's draft. Published markers (see
// src/models/draft-schema.ts) are left out of everything but getDraft.
import {
	type Draft,
	type DraftTarget,
	draftModel
} from "../models/draft-schema.ts";
import {
	isDuplicateKeyError,
	searchPattern,
	tagsMatching
} from "../helpers/editor-queries.ts";
import {
	COLLECTION_DRAFT_TYPE_NAMES,
	type DraftTypeName
} from "../types/editor-content.ts";
import { draftSummaries } from "../api/response-schemas.ts";

const UNPUBLISHED = { publishedAs: { $exists: false } };

/** A stored draft, with its `_id` as `id`, as every function returns it. */
export type StoredDraft = Omit<Draft, "_id"> & { readonly id: string };

function withId({ _id, ...draft }: Draft): StoredDraft {
	return { ...draft, id: _id };
}

// The fields the contract's DraftSummary sends of any type's draft.
const SUMMARY_FIELDS = [
	...new Set(
		draftSummaries.element.options.flatMap(({ shape }) =>
			Object.keys(shape.fields.shape)
		)
	)
];

const TYPES_WITH_DIMENSIONS: readonly DraftTypeName[] = [
	"maps",
	...COLLECTION_DRAFT_TYPE_NAMES
];

/** A draft in a list; a map season's or collection's counts its dimensions. */
export type DraftSummary = StoredDraft & { readonly dimensionCount?: number };

// The owner's drafts, most recently saved first, optionally of one type, with
// only their SUMMARY_FIELDS (getDraft has the rest).
export async function listDrafts(
	owner: string,
	type?: DraftTypeName
): Promise<DraftSummary[]> {
	const found = await draftModel.aggregate<
		Draft & { dimensionCount?: number }
	>([
		{
			$match: {
				owner,
				...UNPUBLISHED,
				...(type !== undefined && { type })
			}
		},
		{ $sort: { updatedAt: -1 } },
		{
			$project: {
				type: 1,
				revision: 1,
				target: 1,
				createdAt: 1,
				updatedAt: 1,
				...Object.fromEntries(
					SUMMARY_FIELDS.map((field) => [`fields.${field}`, 1])
				),
				dimensionCount: {
					$cond: [
						{ $in: ["$type", TYPES_WITH_DIMENSIONS] },
						{ $size: { $ifNull: ["$fields.dimensions", []] } },
						"$$REMOVE"
					]
				}
			}
		}
	]);
	return found.map((draft) => withId({ fields: {}, ...draft }));
}

// The tags on the owner's gallery drafts containing `query` (case-insensitive;
// empty is every tag), sorted.
export async function getDraftTags(
	owner: string,
	query: string
): Promise<string[]> {
	const tags = await draftModel.aggregate<{ _id: string }>([
		{ $match: { owner, type: "gallery", ...UNPUBLISHED } },
		...tagsMatching("fields.tags", searchPattern(query))
	]);
	return tags.map(({ _id }) => _id);
}

// The owner's draft with this ID, published or not.
export async function getDraft(
	owner: string,
	id: string
): Promise<StoredDraft | undefined> {
	const found = await draftModel.findOne({ _id: id, owner }).lean();
	return found ? withId(found) : undefined;
}

// Whether anyone's draft has this ID: a client UUID taken by another editor
// must not be reused (nor revealed).
export async function draftIdTaken(id: string): Promise<boolean> {
	return (await draftModel.exists({ _id: id })) !== null;
}

export async function countDrafts(owner: string): Promise<number> {
	return draftModel.countDocuments({ owner, ...UNPUBLISHED });
}

// The owner's edit draft of an item, if they have one.
export async function getTargetDraft(
	owner: string,
	type: DraftTypeName,
	targetId: string
): Promise<StoredDraft | undefined> {
	const found = await draftModel
		.findOne({ owner, type, "target.id": targetId, ...UNPUBLISHED })
		.lean();
	return found ? withId(found) : undefined;
}

export type DraftWriteResult =
	| { readonly outcome: "ok"; readonly draft: StoredDraft }
	| { readonly outcome: "stale" }
	/** The owner already has an edit draft of that item, or the ID is taken. */
	| { readonly outcome: "duplicate" };

export async function createDraft(draft: {
	readonly id: string;
	readonly owner: string;
	readonly type: DraftTypeName;
	readonly fields: Record<string, unknown>;
	readonly target?: DraftTarget;
}): Promise<DraftWriteResult> {
	const { id, ...fields } = draft;
	try {
		const created = await draftModel.create({
			_id: id,
			...fields,
			revision: 1
		});
		return { outcome: "ok", draft: withId(created.toObject()) };
	} catch (error) {
		if (isDuplicateKeyError(error)) {
			return { outcome: "duplicate" };
		}
		throw error;
	}
}

// Replaces an unpublished draft's fields, from the revision the client last
// saw (another device may have saved since).
export async function updateDraft(
	owner: string,
	id: string,
	revision: number,
	fields: Record<string, unknown>
): Promise<DraftWriteResult> {
	const updated = await draftModel
		.findOneAndUpdate(
			{ _id: id, owner, revision, ...UNPUBLISHED },
			{ $set: { fields }, $inc: { revision: 1 } },
			{ returnDocument: "after" }
		)
		.lean();
	return updated
		? { outcome: "ok", draft: withId(updated) }
		: { outcome: "stale" };
}

// False when the owner has no such unpublished draft.
export async function deleteDraft(owner: string, id: string): Promise<boolean> {
	const { deletedCount } = await draftModel.deleteOne({
		_id: id,
		owner,
		...UNPUBLISHED
	});
	return deletedCount === 1;
}

// Replaces a published draft with a marker naming the item, until
// `expiresAt`, so repeating the publish returns that item. Only from the
// revision that was published: a draft saved (or deleted) since keeps the
// newer work, which isn't in the item.
export async function markPublished(
	owner: string,
	id: string,
	revision: number,
	itemId: string,
	expiresAt: Date
): Promise<void> {
	await draftModel.updateOne(
		{ _id: id, owner, revision, ...UNPUBLISHED },
		{
			$set: { publishedAs: itemId, expiresAt },
			$unset: { fields: "", target: "" }
		}
	);
}
