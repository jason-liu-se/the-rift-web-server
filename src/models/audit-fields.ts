import mongoose from "mongoose";

// What every content document (news posts, gallery images, download items, map
// seasons, gallery and download collections) records about its edits. Every
// field is optional: documents added to MongoDB by hand before the editor
// tools lack them. A missing `visible` counts as visible, a missing `revision`
// as 0, and missing audit fields stay missing ("unknown" in the editor).

/**
 * The Discord user behind an edit, as they were when they made it, stored so
 * listing needs no Discord call. The avatar's URL stops loading once they
 * change it.
 */
export interface EditorRef {
	readonly id: string;
	readonly username: string;
	readonly avatarUrl?: string;
}

export interface Audited {
	readonly visible?: boolean;
	/** Incremented by every write; updates and deletes send the one they read. */
	readonly revision?: number;
	readonly createdBy?: EditorRef;
	readonly lastUpdatedBy?: EditorRef;
	readonly createdAt?: Date;
	readonly updatedAt?: Date;
	/** The client's UUID for the create, so repeating it can't duplicate. */
	readonly createId?: string;
}

const editorRefSchema = new mongoose.Schema<EditorRef>(
	{
		id: { type: String, required: true },
		username: { type: String, required: true },
		avatarUrl: { type: String }
	},
	{ _id: false, id: false }
);

// Matches visible documents, including those without `visible`.
export const VISIBLE = { visible: { $ne: false } };

// Spread into each content schema, which also sets AUDITED_SCHEMA_OPTIONS.
export const auditedFields = {
	visible: { type: Boolean },
	revision: { type: Number },
	createdBy: { type: editorRefSchema },
	lastUpdatedBy: { type: editorRefSchema },
	// Sparse: documents made before the editor tools have none.
	createId: { type: String, unique: true, sparse: true }
};

// Mongoose sets createdAt on create and updatedAt on every write; neither is
// added to an old document until it's written.
export const AUDITED_SCHEMA_OPTIONS = { timestamps: true } as const;
