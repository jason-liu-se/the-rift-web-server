import mongoose from "mongoose";
import { type Audited, auditedFields } from "./audit-fields.ts";
import {
	COLLECTIONS_COLLECTION,
	type ContentCollection,
	ITEM_SCHEMA_OPTIONS,
	contentCollectionSchema
} from "./content-collection-schema.ts";

// One document per image, whatever its gallery; galleries are listed in
// `collections`. Newest first is by `_id`, which holds the creation time.
export interface GalleryImage extends Audited {
	/** The gallery's slug (`collections`). */
	readonly collection: string;
	readonly caption: string;
	readonly imageUrl: string;
	/** Lowercase, trimmed, and unique; missing on images stored before tags. */
	readonly tags?: string[];
}

const galleryImageSchema = new mongoose.Schema<GalleryImage>(
	{
		collection: { type: String, required: true },
		caption: { type: String, required: true },
		imageUrl: { type: String, required: true },
		tags: { type: [String], default: undefined },
		...auditedFields
	},
	ITEM_SCHEMA_OPTIONS
);
galleryImageSchema.index({ collection: 1, visible: 1, _id: -1 });
galleryImageSchema.index({ collection: 1, tags: 1 });

export const galleryDb = mongoose.connection.useDb("gallery");

// Collection names are passed explicitly: these models are compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const galleryImageModel = galleryDb.model<GalleryImage>(
	"GalleryImage",
	galleryImageSchema,
	"images"
);

export const galleryCollectionModel = galleryDb.model<ContentCollection>(
	"GalleryCollection",
	contentCollectionSchema,
	COLLECTIONS_COLLECTION
);
