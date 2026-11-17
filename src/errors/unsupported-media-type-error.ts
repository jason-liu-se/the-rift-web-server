// Thrown when a request body isn't in a format the API accepts. The app's error
// handler answers 415 with this message, so it must be safe to show the caller.
export class UnsupportedMediaTypeError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "UnsupportedMediaTypeError";
	}
}
