import mongoose from "mongoose";

// The site's one content version: public reads are cached under it (`?v=`),
// so changing it shows every edit on the next page load. Stored as
// `{ _id: "contentVersion", version: <ms timestamp> }`.
export interface ContentVersion {
	readonly _id: string;
	readonly version: number;
}

const contentVersionSchema = new mongoose.Schema<ContentVersion>({
	_id: { type: String, required: true },
	version: { type: Number, required: true }
});

export const contentDb = mongoose.connection.useDb("content");

// The collection name is passed explicitly: this model is compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const contentVersionModel = contentDb.model<ContentVersion>(
	"ContentVersion",
	contentVersionSchema,
	"meta"
);

export const CONTENT_VERSION_ID = "contentVersion";
