import { IMAGE_URL_PREFIXES } from "../config/images.ts";

export function isAllowedImageUrl(url: string): boolean {
	return IMAGE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
