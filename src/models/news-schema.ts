import mongoose from "mongoose";

export interface NewsItem {
	title: string;
	date: Date;
	content: string;
}

const newsSchema = new mongoose.Schema<NewsItem>({
	title: { type: String, required: true },
	date: { type: Date, required: true },
	content: { type: String, required: true }
});

const db = mongoose.connection.useDb("news");

export const model = db.model<NewsItem>("news-items", newsSchema);
