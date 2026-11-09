// Thrown when the requested resource doesn't exist. The app's error handler
// answers 404 with this message, so it must be safe to show the caller.
export class NotFoundError extends Error {
	readonly resource: string;

	constructor(resource: string, options?: ErrorOptions) {
		super(`${resource} not found`, options);
		this.name = "NotFoundError";
		this.resource = resource;
	}
}
