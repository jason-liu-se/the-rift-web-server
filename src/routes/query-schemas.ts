// Zod schemas for the routes' inputs: path and query parameters, and cookies.
// Routes call `.parse(req.params)` / `.parse(req.query)`; the app's error
// handler turns a failed parse into a 400 response.
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

// A cookie's value, or undefined when it's absent or not a plain non-empty
// string (cookie-parser turns `j:`-prefixed values into objects). Never fails:
// a bad cookie just counts as missing.
export const cookieValue = z.string().min(1).optional().catch(undefined);

// Discord's redirect back from a login. Discord adds `error` (e.g.
// access_denied) instead of `code` when the user cancels or the request was
// invalid. Parsed with safeParse: the callback redirects instead of answering
// 400.
export const discordCallbackQuery = z.object({
	code: z.string().min(1).optional(),
	state: z.string().min(1).optional(),
	error: z.string().optional()
});
