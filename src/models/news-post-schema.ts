import mongoose from "mongoose";
import {
	AUDITED_SCHEMA_OPTIONS,
	type Audited,
	auditedFields
} from "./audit-fields.ts";

// A post is public when visible and its date has come, so a visible post with
// a future date is scheduled and goes live without a write.
export interface NewsPost extends Audited {
	readonly title: string;
	readonly date: Date;
	readonly content: string;
	readonly imageUrl?: string;
	/**
	 * Whether the post had been public by its last write. Going live by date
	 * writes nothing, so writes also check whether it's public now.
	 */
	readonly wasPublic?: boolean;
	/** When the title or content last changed after the post was public. */
	readonly editedAt?: Date;
}

const newsPostSchema = new mongoose.Schema<NewsPost>(
	{
		title: { type: String, required: true },
		date: { type: Date, required: true },
		content: { type: String, required: true },
		imageUrl: { type: String },
		wasPublic: { type: Boolean },
		editedAt: { type: Date },
		...auditedFields
	},
	AUDITED_SCHEMA_OPTIONS
);
newsPostSchema.index({ visible: 1, date: -1 });

export const newsDb = mongoose.connection.useDb("news");

// The collection name is passed explicitly: this model is compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const newsPostModel = newsDb.model<NewsPost>(
	"NewsPost",
	newsPostSchema,
	"posts"
);
