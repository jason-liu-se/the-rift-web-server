import mongoose from "mongoose";

// An editor's unpublished work, private to its owner: a new item, or an edit
// of a published one (`target`). Saved loosely as the editor types; checked
// fully on publish. Publishing turns it into a marker (`publishedAs`, no
// fields) that expires, so a repeated publish returns the same item.
export interface DraftTarget {
	readonly id: string;
	/** The item's revision when the draft started from it. */
	readonly startRevision: number;
}

export interface Draft {
	/** The client's UUID; doubles as the createId of the item it publishes. */
	readonly _id: string;
	/** Discord user ID. */
	readonly owner: string;
	readonly type: string;
	readonly fields?: Record<string, unknown>;
	/** The draft's own, incremented by every save. */
	readonly revision: number;
	readonly target?: DraftTarget;
	/** The item's ID, once published. */
	readonly publishedAs?: string;
	/** When a published marker is deleted (a TTL index). */
	readonly expiresAt?: Date;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

const draftTargetSchema = new mongoose.Schema<DraftTarget>(
	{
		id: { type: String, required: true },
		startRevision: { type: Number, required: true }
	},
	{ _id: false, id: false }
);

const draftSchema = new mongoose.Schema<Draft>(
	{
		_id: { type: String, required: true },
		owner: { type: String, required: true },
		type: { type: String, required: true },
		fields: { type: mongoose.Schema.Types.Mixed },
		revision: { type: Number, required: true },
		target: { type: draftTargetSchema },
		publishedAs: { type: String },
		expiresAt: { type: Date }
	},
	// minimize: false keeps an empty `fields` ({}) instead of dropping it.
	{ timestamps: true, minimize: false }
);
draftSchema.index({ owner: 1, updatedAt: -1 });
// One edit draft per editor per item. Published markers drop their target.
draftSchema.index(
	{ owner: 1, type: 1, "target.id": 1 },
	{
		unique: true,
		partialFilterExpression: { "target.id": { $exists: true } }
	}
);
draftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const editorDb = mongoose.connection.useDb("editor");

// The collection name is passed explicitly: this model is compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const draftModel = editorDb.model<Draft>("Draft", draftSchema, "drafts");
