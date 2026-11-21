// Tunable limits on image uploads (POST /editor/images).

/** Files per upload request. */
export const MAX_UPLOAD_FILES = 20;

/** One file's size, in bytes. imgbb itself takes up to 32 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
