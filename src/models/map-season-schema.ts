import mongoose from "mongoose";
import {
	AUDITED_SCHEMA_OPTIONS,
	type Audited,
	auditedFields
} from "./audit-fields.ts";
import { type Dimension, dimensionFields } from "./dimension-schema.ts";
import { blankableText } from "./text-field.ts";

export interface MapDimension extends Dimension {
	readonly worldId: string;
	readonly perspective: string;
}

export interface MapSeason extends Audited {
	readonly season: number;
	readonly imageUrl?: string;
	readonly dimensions?: MapDimension[];
}

const mapDimensionSchema = new mongoose.Schema<MapDimension>(
	{
		...dimensionFields,
		worldId: { type: String, required: true },
		perspective: blankableText<MapDimension>("perspective")
	},
	{ _id: false }
);

const mapSeasonSchema = new mongoose.Schema<MapSeason>(
	{
		// Unique: a clash is a 409.
		season: { type: Number, required: true, unique: true },
		imageUrl: { type: String },
		dimensions: { type: [mapDimensionSchema] },
		...auditedFields
	},
	AUDITED_SCHEMA_OPTIONS
);

export const mapsDb = mongoose.connection.useDb("maps");

// The collection name is passed explicitly: this model is compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const mapSeasonModel = mapsDb.model<MapSeason>(
	"MapSeason",
	mapSeasonSchema,
	"seasons"
);
