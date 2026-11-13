// Thrown when a route needs a logged-in user and there isn't one. The app's
// error handler answers 401 with this message, so it must be safe to show the
// caller.
export class UnauthorizedError extends Error {
	constructor(message = "not logged in", options?: ErrorOptions) {
		super(message, options);
		this.name = "UnauthorizedError";
	}
}
