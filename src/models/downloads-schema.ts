import mongoose from "mongoose";

export interface DownloadItem {
	title: string;
	desc: string;
	downloadUrl: string;
	backgroundUrl: string;
}

const downloadsSchema = new mongoose.Schema<DownloadItem>({
	title: { type: String, required: true },
	desc: { type: String, required: true },
	downloadUrl: { type: String, required: true },
	backgroundUrl: { type: String, required: true }
});

const db = mongoose.connection.useDb("downloads");

export function getModel(modelName: string) {
	return db.model<DownloadItem>(modelName, downloadsSchema);
}
