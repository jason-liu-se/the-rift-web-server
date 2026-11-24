// Every call to imgbb's API (https://api.imgbb.com/). It can't choose an
// album or delete an image, so uploads are named for sorting by hand (README
// "Image uploads"). Failures are logged here in detail, never with the API
// key, and thrown as ImgbbError for the caller to report generically.
import * as z from "zod";
import { IMGBB_TIMEOUT_MS } from "../config/timeouts.ts";
import { isAllowedImageUrl } from "../api/images.ts";

const UPLOAD_URL = "https://api.imgbb.com/1/upload";

export class ImgbbError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ImgbbError";
	}
}

// A URL the editor couldn't then save (another host) is a failure too.
const uploadResponse = z.object({
	data: z.object({ url: z.string().refine(isAllowedImageUrl) })
});

// What imgbb says went wrong, when it says.
const errorResponse = z.object({
	error: z.object({ message: z.string() }).optional()
});

// Uploads one image and returns its direct URL.
export async function uploadImage(
	apiKey: string,
	image: Buffer,
	name: string
): Promise<string> {
	const form = new FormData();
	form.set("image", new Blob([image]));
	form.set("name", name);

	let response: Response;
	try {
		response = await fetch(
			`${UPLOAD_URL}?key=${encodeURIComponent(apiKey)}`,
			{
				method: "POST",
				body: form,
				signal: AbortSignal.timeout(IMGBB_TIMEOUT_MS)
			}
		);
	} catch (error) {
		// Fetch errors name the failure (a timeout, DNS), not the URL.
		const reason = error instanceof Error ? error.message : String(error);
		console.error(`ERROR: imgbb upload of '${name}' failed: ${reason}`);
		throw new ImgbbError("imgbb unreachable", { cause: error });
	}

	const body: unknown = await response.json().catch(() => undefined);
	const uploaded = uploadResponse.safeParse(body);
	if (response.ok && uploaded.success) {
		return uploaded.data.data.url;
	}
	const message = errorResponse.safeParse(body).data?.error?.message;
	console.error(
		`ERROR: imgbb upload of '${name}' failed: ${response.status}${message ? ` (${message})` : ""}`
	);
	throw new ImgbbError(`imgbb answered ${response.status}`);
}
