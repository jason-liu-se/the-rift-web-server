// Zod schemas for the routes' path and query parameters. Routes call
// `.parse(req.params)` / `.parse(req.query)`; the app's error handler turns a
// failed parse into a 400 response.
import * as z from "zod";

// MongoDB rejects collection names containing `$` or a null character, and
// reserves the `system.` prefix.
const VALID_COLLECTION_NAME = /^(?!system\.)[^$\0]+$/;

const collectionName = z
	.string({ error: "a collection name is required" })
	.regex(VALID_COLLECTION_NAME, "invalid collection name");

// For routes shaped like `/:collection`.
export const collectionParams = z.object({ collection: collectionName });

export const paginationQuery = z.object({
	startIndex: z.coerce.number().int().min(0).default(0),
	// Omitted returns every item from `startIndex` onwards.
	limit: z.coerce.number().int().min(1).optional()
});

// Deprecated routes take the collection as a query parameter instead.
export const collectionQuery = z.object({ collection: collectionName });

export const paginatedCollectionQuery = collectionQuery.extend(
	paginationQuery.shape
);
