import mongoose from "mongoose";
import {
	AUDITED_SCHEMA_OPTIONS,
	type Audited,
	auditedFields
} from "./audit-fields.ts";

// A gallery or download collection's metadata. Its items name it by `slug`,
// which is fixed once created (it's in the website's URLs).
export interface ContentCollection extends Audited {
	readonly slug: string;
	readonly title: string;
}

export const contentCollectionSchema = new mongoose.Schema<ContentCollection>(
	{
		slug: { type: String, required: true, unique: true },
		title: { type: String, required: true },
		...auditedFields
	},
	AUDITED_SCHEMA_OPTIONS
);

// The Mongo collection holding a database's collection metadata.
export const COLLECTIONS_COLLECTION = "collections";

// Items name their collection in a field called `collection`, which Mongoose
// reserves for documents' own Mongo collection. Reads are lean and writes go
// through the model's static methods, which don't use that property.
export const ITEM_SCHEMA_OPTIONS = {
	...AUDITED_SCHEMA_OPTIONS,
	suppressReservedKeysWarning: true
} as const;
