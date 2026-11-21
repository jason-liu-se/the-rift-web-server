// Thrown when a write conflicts with what's stored: a stale revision (someone
// saved since), or a taken slug or season. The app's error handler answers 409
// with this message and, for a stale revision, `current` (already sent through
// its response schema), so the editor can show both versions.
export class ConflictError extends Error {
	readonly current: unknown;

	constructor(message: string, current?: unknown, options?: ErrorOptions) {
		super(message, options);
		this.name = "ConflictError";
		this.current = current;
	}
}
