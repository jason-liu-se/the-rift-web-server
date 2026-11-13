import mongoose from "mongoose";

// What an access grant's subjectId identifies: one Discord user, a role in The
// Rift's Discord server (DISCORD_GUILD_ID), or every member of a Discord server.
export const ACCESS_GRANT_SUBJECT_TYPES = ["user", "role", "server"] as const;

export type AccessGrantSubjectType =
	(typeof ACCESS_GRANT_SUBJECT_TYPES)[number];

// Lets whoever it matches log in. Stored IDs are Discord snowflakes as strings
// (numbers would lose precision).
export interface AccessGrant {
	readonly subjectId: string;
	readonly subjectType: AccessGrantSubjectType;
	/** Discord user ID of whoever added the grant. */
	readonly createdBy: string;
	readonly createdAt: Date;
}

const accessGrantSchema = new mongoose.Schema<AccessGrant>(
	{
		subjectId: { type: String, required: true },
		subjectType: {
			type: String,
			enum: ACCESS_GRANT_SUBJECT_TYPES,
			required: true
		},
		createdBy: { type: String, required: true }
	},
	{ timestamps: { createdAt: true, updatedAt: false } }
);

export const authDb = mongoose.connection.useDb("auth");

export const accessGrantModel = authDb.model<AccessGrant>(
	"access-grants",
	accessGrantSchema
);
