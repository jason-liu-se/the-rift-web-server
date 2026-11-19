import mongoose from "mongoose";

export interface NewsPost {
	readonly title: string;
	readonly date: Date;
	readonly content: string;
	readonly imageUrl?: string;
}

const newsPostSchema = new mongoose.Schema<NewsPost>({
	title: { type: String, required: true },
	date: { type: Date, required: true },
	content: { type: String, required: true },
	imageUrl: { type: String }
});

export const newsDb = mongoose.connection.useDb("news");

// The collection name is passed explicitly: this model is compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const newsPostModel = newsDb.model<NewsPost>(
	"NewsPost",
	newsPostSchema,
	"posts"
);
