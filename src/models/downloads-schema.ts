import mongoose from "mongoose";

export interface DownloadItem {
	readonly title: string;
	readonly desc: string;
	readonly downloadUrl: string;
	readonly backgroundUrl: string;
}

const downloadsSchema = new mongoose.Schema<DownloadItem>({
	title: { type: String, required: true },
	desc: { type: String, required: true },
	downloadUrl: { type: String, required: true },
	backgroundUrl: { type: String, required: true }
});

export const downloadsDb = mongoose.connection.useDb("downloads");

export function getDownloadModel(collectionName: string) {
	return downloadsDb.model<DownloadItem>(collectionName, downloadsSchema);
}
