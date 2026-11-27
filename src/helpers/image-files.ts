// The image types uploads accept, told from a file's first bytes (its "magic
// number"), never its name or the type the browser claims.
export type ImageType = "png" | "jpeg" | "webp" | "gif";

function startsWith(file: Buffer, bytes: readonly number[], at = 0): boolean {
	return bytes.every((byte, index) => file[at + index] === byte);
}

const ASCII = (text: string) => [...text].map((char) => char.charCodeAt(0));

export function imageTypeOf(file: Buffer): ImageType | undefined {
	if (startsWith(file, [0x89, ...ASCII("PNG"), 0x0d, 0x0a, 0x1a, 0x0a])) {
		return "png";
	}
	if (startsWith(file, [0xff, 0xd8, 0xff])) {
		return "jpeg";
	}
	if (startsWith(file, ASCII("RIFF")) && startsWith(file, ASCII("WEBP"), 8)) {
		return "webp";
	}
	if (
		startsWith(file, ASCII("GIF87a")) ||
		startsWith(file, ASCII("GIF89a"))
	) {
		return "gif";
	}
	return undefined;
}
