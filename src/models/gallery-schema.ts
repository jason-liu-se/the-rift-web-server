import mongoose from "mongoose";

export interface GalleryImageVariants {
	readonly mobile?: string;
	readonly tablet?: string;
	readonly desktop?: string;
}

export interface GalleryImage {
	readonly caption: string;
	readonly url: string;
	readonly variants?: GalleryImageVariants;
}

const galleryImageVariantsSchema = new mongoose.Schema<GalleryImageVariants>(
	{ mobile: String, tablet: String, desktop: String },
	{ _id: false }
);

const gallerySchema = new mongoose.Schema<GalleryImage>({
	caption: { type: String, required: true },
	url: { type: String, required: true },
	variants: galleryImageVariantsSchema
});

export const galleryDb = mongoose.connection.useDb("gallery");

export function getGalleryModel(collectionName: string) {
	return galleryDb.model<GalleryImage>(collectionName, gallerySchema);
}
