import mongoose from "mongoose";

export interface Post {
	readonly title: string;
	readonly date: Date;
	readonly content: string;
	readonly bannerImg?: string;
}

const postSchema = new mongoose.Schema<Post>({
	title: { type: String, required: true },
	date: { type: Date, required: true },
	content: { type: String, required: true },
	bannerImg: { type: String }
});

export const newsDb = mongoose.connection.useDb("news");

export const postModel = newsDb.model<Post>("posts", postSchema);
