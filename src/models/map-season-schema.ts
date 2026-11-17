import mongoose from "mongoose";

export interface MapDimension {
	readonly name: string;
	readonly imageUrl: string;
	readonly perspective: string;
}

export interface MapSeason {
	readonly season: number;
	readonly imageUrl: string;
	readonly dimensions: MapDimension[];
}

const mapDimensionSchema = new mongoose.Schema<MapDimension>(
	{
		name: { type: String, required: true },
		imageUrl: { type: String, required: true },
		perspective: { type: String, required: true }
	},
	{ _id: false }
);

const mapSeasonSchema = new mongoose.Schema<MapSeason>({
	season: { type: Number, required: true },
	imageUrl: { type: String, required: true },
	dimensions: { type: [mapDimensionSchema], required: true }
});

export const mapsDb = mongoose.connection.useDb("maps");

// The collection name is passed explicitly: this model is compiled on import,
// before `connect` turns off Mongoose's pluralizer.
export const mapSeasonModel = mapsDb.model<MapSeason>(
	"MapSeason",
	mapSeasonSchema,
	"seasons"
);
