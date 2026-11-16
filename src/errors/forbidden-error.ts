// Thrown when a request is refused whoever sends it, e.g. a write that didn't
// come from the website. The app's error handler answers 403 with this
// message, so it must be safe to show the caller.
export class ForbiddenError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ForbiddenError";
	}
}
