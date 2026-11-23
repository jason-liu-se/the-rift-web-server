// Building editor-content's queries (src/managers/editor-content.ts) and
// reading their results: pure functions of a content type's descriptor, with
// no database access.
import type { NewsStatus } from "../contract/api-responses.ts";
import type { EditorRef } from "../models/audit-fields.ts";
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

// Missing `visible` (documents from before the editor tools) counts as
// visible.
const VISIBLE = { visible: { $ne: false } };

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

// The field a MongoDB duplicate key error is about, or undefined for any
// other error.
export function duplicateKeyField(error: unknown): string | undefined {
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
