// The editor tools' content types and writes: what editor-content
// (src/managers/editor-content.ts) and its query helpers
// (src/helpers/editor-queries.ts) take and return.
import type { Model, PipelineStage, Types } from "mongoose";
import type { NewsStatus } from "../contract/api-responses.ts";
import type { Audited } from "../models/audit-fields.ts";
import type { ContentCollection } from "../models/content-collection-schema.ts";

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
export type SearchField = (pattern: RegExp, query: string) => object;

export interface ContentType {
	/** What an item is called in messages. */
	readonly itemName: string;
	readonly model: Model<StoredItem>;
	/** The statuses its items can have, and how each is found. */
	readonly statuses: StatusRules;
	readonly searchFields: Readonly<Record<string, SearchField>>;
	/** The public order. */
	readonly sort: readonly PipelineStage[];
	/** What makes an item a list's summary (only `getItem` sends it whole). */
	readonly summary: PipelineStage[];
	/** For gallery and downloads: their collections' metadata. */
	readonly collectionModel?: Model<ContentCollection>;
}

export interface StatusRules {
	/** An item's status. */
	readonly of: (item: StoredItem, now: Date) => NewsStatus;
	/** The filter for each status the type has (its list's `status`). */
	readonly filters: Readonly<
		Partial<Record<NewsStatus, (now: Date) => object>>
	>;
}

export type SortOrder = "asc" | "desc";

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
	/** Gallery only: images with every tag. */
	readonly tags?: readonly string[];
	/** The fields to sort by, most significant first (none: the public order). */
	readonly sort: readonly string[];
	/** Each `sort` field's order, by position (missing: ascending). */
	readonly order: readonly SortOrder[];
}

export interface EditorCollectionSummary extends ContentCollection {
	readonly itemCount: number;
}

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
	| Duplicate
	/** A repeat whose item was deleted since the first create made it. */
	| { readonly outcome: "not-found" };

/** An item refused before writing, with why (a single write's 400). */
export interface Invalid {
	readonly outcome: "invalid";
	readonly error: unknown;
}

export type ItemOutcome = WriteResult | CreateResult | Invalid;

export type WriteOp =
	| {
			readonly name: "updateOne";
			readonly filter: object;
			readonly update: object;
	  }
	| { readonly name: "deleteOne"; readonly filter: object };

export type CollectionWriteResult =
	| { readonly outcome: "ok"; readonly collection?: EditorCollectionSummary }
	| Duplicate
	| {
			readonly outcome: "conflict";
			readonly current: EditorCollectionSummary;
	  }
	| { readonly outcome: "not-found" };
