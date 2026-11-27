// Thrown when a request is invalid in a way only the server's data can show
// (e.g. a news date earlier than the stored post's). Schema problems are
// ZodErrors instead. The app's error handler answers 400 with this message,
// so it must be safe to show the caller.
export class BadRequestError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "BadRequestError";
	}
}
