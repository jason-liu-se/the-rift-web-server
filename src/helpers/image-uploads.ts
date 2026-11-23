// Uploads the editor's image files to imgbb (POST /editor/images), a few at a
// time, each named for its album. A file that isn't an image, or that
// imgbb fails on, gets an error result instead of failing the others.
import { IMGBB_CONCURRENT_UPLOADS } from "../config/uploads.ts";
import type { ImageUploadResult } from "../contract/api-responses.ts";
import type { ImageUploadFields } from "../api/write-schemas.ts";
import { imageTypeOf } from "./image-files.ts";
import { ImgbbError, uploadImage } from "../managers/imgbb.ts";

const MAX_NAME_LENGTH = 60;

export interface UploadFile {
	readonly originalname: string;
	readonly buffer: Buffer;
}

// The album picks the name prefix: `g-<slug>-`, `n-`, `d-`, or `m-`.
function namePrefix(fields: ImageUploadFields): string {
	return fields.album === "gallery"
		? `g-${fields.collection}-`
		: `${fields.album[0]}-`;
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

async function uploadOne(
	apiKey: string,
	file: UploadFile,
	name: string
): Promise<ImageUploadResult> {
	if (!imageTypeOf(file.buffer)) {
		return { name, error: "not a PNG, JPEG, WebP, or GIF image" };
	}
	try {
		return { name, url: await uploadImage(apiKey, file.buffer, name) };
	} catch (error) {
		if (error instanceof ImgbbError) {
			return { name, error: "the image host failed; try again" };
		}
		throw error;
	}
}

// One result per file, in the files' order.
export function uploadImages(
	apiKey: string,
	fields: ImageUploadFields,
	files: readonly UploadFile[]
): Promise<ImageUploadResult[]> {
	const prefix = namePrefix(fields);
	return mapLimited(files, IMGBB_CONCURRENT_UPLOADS, (file) =>
		uploadOne(apiKey, file, `${prefix}${baseName(file.originalname)}`)
	);
}
