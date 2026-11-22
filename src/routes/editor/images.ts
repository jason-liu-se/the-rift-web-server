// Image uploads (POST /editor/images): the files go through this server to
// imgbb, since the API key must stay secret. multer parses this route's
// multipart body (after the login gate; jsonBody lets it through), keeping
// files in memory within the limits in src/config/uploads.ts; the uploading
// is in src/helpers/image-uploads.ts.
import express, { type RequestHandler, type Router } from "express";
import multer from "multer";
import type { AppConfig } from "../../config/env.ts";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "../../config/uploads.ts";
import { BadRequestError } from "../../errors/bad-request-error.ts";
import { uploadImages } from "../../helpers/image-uploads.ts";
import {
	imageUploadResponse,
	parseResponse
} from "../../api/response-schemas.ts";
import { imageUploadFields } from "../../api/write-schemas.ts";

/** Where uploads are sent; jsonBody skips this path's multipart body. */
export const IMAGE_UPLOAD_PATH = "/editor/images";

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

export function imagesRouter(config: AppConfig): Router {
	const router = express.Router();

	router.post("/", parseFiles, async (req, res) => {
		const fields = imageUploadFields.parse(req.body);
		const files = Array.isArray(req.files) ? req.files : [];
		if (files.length === 0) {
			throw new BadRequestError("files: at least one image is required");
		}

		const results = await uploadImages(config.IMGBB_API_KEY, fields, files);
		res.json(parseResponse(imageUploadResponse, { results }));
	});

	return router;
}
