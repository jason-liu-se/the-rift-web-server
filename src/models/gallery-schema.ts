import mongoose from "mongoose";

export interface GalleryImage {
	readonly caption: string;
	readonly url: string;
}

const gallerySchema = new mongoose.Schema<GalleryImage>({
	caption: { type: String, required: true },
	url: { type: String, required: true }
});

const db = mongoose.connection.useDb("gallery");

export function getModel(modelName: string) {
	return db.model<GalleryImage>(modelName, gallerySchema);
}
