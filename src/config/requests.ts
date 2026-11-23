// Tunable limits on what a request may send.

/** The largest JSON body accepted (bytes, or a string like "100kb"). */
export const JSON_BODY_LIMIT = "100kb";

/** The most items one bulk request may act on; the website splits larger ones. */
export const MAX_BULK_ITEMS = 50;

/** The most items an editor list returns at once, and its default `limit`. */
export const MAX_EDITOR_PAGE_SIZE = 25;
