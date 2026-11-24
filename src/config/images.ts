// Every image URL editors save must start with one of these, so the website
// only ever loads images from hosts we trust. The website keeps its own copy
// to flag bad links early; this one is enforced. imgbb is where uploads go
// (POST /editor/images); imgur holds the images added before uploads.
export const IMAGE_URL_PREFIXES: readonly string[] = [
	"https://i.ibb.co/",
	"https://i.imgur.com/",
	"https://imgur.com/"
];

export function isAllowedImageUrl(url: string): boolean {
	return IMAGE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
