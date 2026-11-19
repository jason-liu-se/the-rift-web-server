import mongoose from "mongoose";

export interface GalleryImage {
	readonly caption: string;
	readonly url: string;
}

const gallerySchema = new mongoose.Schema<GalleryImage>({
	caption: { type: String, required: true },
	url: { type: String, required: true }
});

export const galleryDb = mongoose.connection.useDb("gallery");

export function getGalleryModel(collectionName: string) {
	return galleryDb.model<GalleryImage>(collectionName, gallerySchema);
}
