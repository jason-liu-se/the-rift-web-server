import mongoose from "mongoose";

/** A world of a collection or map season (e.g. the nether), with its image. */
export interface Dimension {
	readonly name: string;
	readonly imageUrl: string;
}

// Shared with map dimensions, which add their own fields to these.
export const dimensionFields = {
	name: { type: String, required: true },
	imageUrl: { type: String, required: true }
} as const;

export const dimensionSchema = new mongoose.Schema<Dimension>(dimensionFields, {
	_id: false
});
