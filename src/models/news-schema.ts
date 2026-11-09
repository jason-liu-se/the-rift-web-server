import mongoose from "mongoose";

export interface NewsItem {
	readonly title: string;
	readonly date: Date;
	readonly content: string;
	readonly bannerImg?: string;
}

const newsSchema = new mongoose.Schema<NewsItem>({
	title: { type: String, required: true },
	date: { type: Date, required: true },
	content: { type: String, required: true },
	bannerImg: { type: String }
});

const db = mongoose.connection.useDb("news");

export const model = db.model<NewsItem>("news-items", newsSchema);
