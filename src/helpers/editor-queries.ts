// Building editor-content's queries (src/managers/editor-content.ts) and
// reading their results: pure functions of a content type's descriptor, with
// no database access.
import type { PipelineStage } from "mongoose";
import type { NewsStatus } from "../contract/api-responses.ts";
import { type EditorRef, VISIBLE } from "../models/audit-fields.ts";
import type {
	ContentType,
	Duplicate,
	EditorItem,
	EditorListQuery,
	FieldChanges,
	SearchField,
	StatusRules,
	StoredItem,
	WriteResult
} from "../types/editor-content.ts";

export const textSearch =
	(field: string): SearchField =>
	(pattern) => ({ [field]: pattern });

const HIDDEN = { visible: false };

// Every type's but news's: live when visible, else hidden.
export const LIVE_OR_HIDDEN: StatusRules = {
	of: (item) => (item.visible === false ? "hidden" : "live"),
	filters: { live: () => VISIBLE, hidden: () => HIDDEN }
};

// News also has `scheduled`: visible, but its date hasn't come.
export const NEWS_STATUSES: StatusRules = {
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

// A case-insensitive search for `query` anywhere in a string; an empty one
// matches every string.
export function searchPattern(query: string): RegExp {
	return new RegExp(escapeRegExp(query), "i");
}

// The distinct tags in the array `field` matching `pattern`, sorted, as
// `{ _id: tag }`. The first $match finds the documents, the second their tags.
export function tagsMatching(field: string, pattern: RegExp): PipelineStage[] {
	return [
		{ $match: { [field]: pattern } },
		{ $unwind: `$${field}` },
		{ $match: { [field]: pattern } },
		{ $group: { _id: `$${field}` } },
		{ $sort: { _id: 1 } }
	];
}

export function listFilter(
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
	if (query.tags && query.tags.length > 0) {
		filters.push({ tags: { $all: query.tags } });
	}
	const { q } = query;
	if (q) {
		const pattern = searchPattern(q);
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

// Sort keys other than the field as stored: `id` is `_id`, editors sort by
// username, and the audit fields old items lack sort as their defaults.
const SORT_KEYS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
	["id", "$_id"],
	["createdBy", "$createdBy.username"],
	["lastUpdatedBy", "$lastUpdatedBy.username"],
	["visible", { $ifNull: ["$visible", true] }],
	["revision", { $ifNull: ["$revision", 0] }]
]);

// Text ignoring the case of ASCII letters ($toLower's only); anything else as
// stored (an array by its lowest or highest element).
function sortKey(field: string): object {
	const value = SORT_KEYS.get(field) ?? `$${field}`;
	return {
		$cond: {
			if: { $eq: [{ $type: value }, "string"] },
			then: { $toLower: value },
			else: value
		}
	};
}

// The stages sorting a list by `sort`'s fields (checked against the type's
// by its list query), ties by `_id`. Unindexed, as the keys are computed.
export function sortByFields({
	sort,
	order
}: Pick<EditorListQuery, "sort" | "order">): PipelineStage[] {
	const directions = sort.map((field, i) => [
		`sortKeys.${field}`,
		order[i] === "desc" ? -1 : 1
	]);
	return [
		{
			$set: {
				sortKeys: Object.fromEntries(
					sort.map((field) => [field, sortKey(field)])
				)
			}
		},
		{ $sort: { ...Object.fromEntries(directions), _id: 1 } },
		{ $unset: "sortKeys" }
	];
}

export function toEditorItem(
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

export const DUPLICATE_KEY = 11000;

// Duck-typed: the driver doesn't export its WriteError class.
export function isDuplicateKeyError(error: unknown): error is object {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === DUPLICATE_KEY
	);
}

// The field a MongoDB duplicate key error is about, or undefined for any
// other error.
export function duplicateKeyField(error: unknown): string | undefined {
	if (
		isDuplicateKeyError(error) &&
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
export function uniqueFieldsOf(type: ContentType): string[] {
	return type.model.schema
		.indexes()
		.filter(([, options]) => options.unique)
		.flatMap(([fields]) => Object.keys(fields))
		.filter((field) => field !== "createId");
}

// Bulk write errors don't name the unique index a duplicate key broke, so
// it's the type's one unique field (createId is told apart by looking it up).
export function duplicateOf(type: ContentType): Duplicate {
	const [field, ...others] = uniqueFieldsOf(type);
	if (!field || others.length > 0) {
		throw new Error(
			`duplicate key on a ${type.itemName} without exactly one unique field`
		);
	}
	return { outcome: "duplicate", field };
}

export function revisionFilter(revision: number): object {
	return revision === 0 ? { revision: { $in: [0, null] } } : { revision };
}

// $set for the values, $unset for the nulls.
export function updateOperators(
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

export function withoutNulls(fields: FieldChanges): FieldChanges {
	return Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value != null)
	);
}

// Why a revision-checked write matched nothing: deleted, or saved since.
export function staleOutcome(
	type: ContentType,
	current: StoredItem | undefined,
	now: Date
): WriteResult {
	return current
		? { outcome: "conflict", current: toEditorItem(type, current, now) }
		: { outcome: "not-found" };
}
