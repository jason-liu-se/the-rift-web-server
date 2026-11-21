// Image uploads (POST /editor/images): the files go through this server to
// imgbb, since the API key must stay secret. multer parses this route's
// multipart body (after the login gate; jsonBody lets it through), keeping
// files in memory within the limits in src/config/uploads.ts.
import express, { type RequestHandler, type Router } from "express";
import multer from "multer";
import * as z from "zod";
import type { AppConfig } from "../config/env.ts";
import {
	IMGBB_CONCURRENT_UPLOADS,
	MAX_UPLOAD_BYTES,
	MAX_UPLOAD_FILES
} from "../config/uploads.ts";
import type { ImageUploadForm } from "../contract/api-requests.ts";
import type { ImageUploadResult } from "../contract/api-responses.ts";
import { BadRequestError } from "../errors/bad-request-error.ts";
import { imageTypeOf } from "../helpers/image-files.ts";
import { ImgbbError, uploadImage } from "../managers/imgbb.ts";
import { collectionSlug } from "../api/query-schemas.ts";
import { imageUploadResponse, parseResponse } from "../api/response-schemas.ts";

/** Where uploads are sent; jsonBody skips this path's multipart body. */
export const IMAGE_UPLOAD_PATH = "/editor/images";

const MAX_NAME_LENGTH = 60;

const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: MAX_UPLOAD_BYTES,
		files: MAX_UPLOAD_FILES,
		fields: 2
	}
}).array("files", MAX_UPLOAD_FILES);

// multer's own errors are broken limits (the error handler maps them); any
// other is busboy's, for a malformed or cut-off body: the caller's mistake.
const parseFiles: RequestHandler = (req, res, next) => {
	upload(req, res, (error: unknown) => {
		next(
			error && !(error instanceof multer.MulterError)
				? new BadRequestError("malformed multipart body", {
						cause: error
					})
				: error
		);
	});
};

// Runs `work` on every item, at most `limit` at a time, keeping their order.
async function mapLimited<T, R>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = [];
	for (let start = 0; start < items.length; start += limit) {
		results.push(
			...(await Promise.all(items.slice(start, start + limit).map(work)))
		);
	}
	return results;
}

// What the upload is for, which picks the name prefix: `g-<slug>-`, `n-`,
// `d-`, or `m-`.
const uploadFields = z.toZod<ImageUploadForm>()(
	z.discriminatedUnion("use", [
		z.object({ use: z.literal("gallery"), collection: collectionSlug }),
		z.object({ use: z.enum(["news", "downloads", "maps"]) })
	])
);

function namePrefix(fields: z.infer<typeof uploadFields>): string {
	return fields.use === "gallery"
		? `g-${fields.collection}-`
		: `${fields.use[0]}-`;
}

// The file's own name, made safe for imgbb: lowercase letters, digits, and
// dashes, without the extension.
function baseName(originalName: string): string {
	const name = originalName
		.replace(/\.[^.]*$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_NAME_LENGTH);
	return name || "image";
}

export function imagesRouter(config: AppConfig): Router {
	const router = express.Router();

	router.post("/", parseFiles, async (req, res) => {
		const fields = uploadFields.parse(req.body);
		const files = Array.isArray(req.files) ? req.files : [];
		if (files.length === 0) {
			throw new BadRequestError("files: at least one image is required");
		}
		const prefix = namePrefix(fields);

		const results = await mapLimited(
			files,
			IMGBB_CONCURRENT_UPLOADS,
			async (file): Promise<ImageUploadResult> => {
				const name = `${prefix}${baseName(file.originalname)}`;
				if (!imageTypeOf(file.buffer)) {
					return {
						name,
						error: "not a PNG, JPEG, WebP, or GIF image"
					};
				}
				try {
					return {
						name,
						url: await uploadImage(
							config.IMGBB_API_KEY,
							file.buffer,
							name
						)
					};
				} catch (error) {
					if (error instanceof ImgbbError) {
						return {
							name,
							error: "the image host failed; try again"
						};
					}
					throw error;
				}
			}
		);
		res.json(parseResponse(imageUploadResponse, { results }));
	});

	return router;
}
