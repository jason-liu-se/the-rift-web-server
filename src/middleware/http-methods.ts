// Methods that only read, so they never change anything on the server.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
	return SAFE_METHODS.has(method);
}
