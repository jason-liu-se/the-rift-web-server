// A required string that may be blank (a caption, a description): Mongoose's
// `required` refuses "", so it's required only when it isn't a string.
export function blankableText<Doc>(path: keyof Doc & string) {
	return {
		type: String,
		required(this: Doc): boolean {
			return typeof this[path] !== "string";
		}
	};
}
