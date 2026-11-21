import mongoose from "mongoose";
import { type Audited, auditedFields } from "./audit-fields.ts";
import {
	COLLECTIONS_COLLECTION,
	type ContentCollection,
	ITEM_SCHEMA_OPTIONS,
	contentCollectionSchema
} from "./content-collection-schema.ts";

// One document per download, whatever its group; groups are listed in
// `collections`. Ordered by `sortOrder`, then items without one by title.
export interface DownloadItem extends Audited {
	/** The group's slug (`collections`). */
	readonly collection: string;
	readonly title: string;
	readonly desc: string;
	readonly downloadUrl: string;
	readonly imageUrl: string;
	readonly sortOrder?: number;
}

const downloadItemSchema = new mongoose.Schema<DownloadItem>(
	{
		collection: { type: String, required: true },
		title: { type: String, required: true },
		desc: { type: String, required: true },
		downloadUrl: { type: String, required: true },
		imageUrl: { type: String, required: true },
		sortOrder: { type: Number },
		...auditedFields
	},
	ITEM_SCHEMA_OPTIONS
);
downloadItemSchema.index({ collection: 1, visible: 1, sortOrder: 1, title: 1 });

export const downloadsDb = mongoose.connection.useDb("downloads");

// Collection names are passed explicitly: these models are compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const downloadItemModel = downloadsDb.model<DownloadItem>(
	"DownloadItem",
	downloadItemSchema,
	"items"
);

export const downloadCollectionModel = downloadsDb.model<ContentCollection>(
	"DownloadCollection",
	contentCollectionSchema,
	COLLECTIONS_COLLECTION
);
