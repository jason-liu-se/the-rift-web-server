import type { SessionUser } from "../contract/api-responses.ts";

declare global {
	namespace Express {
		interface Locals {
			/** The logged-in user, set by sessionMiddleware; unset when nobody is. */
			user?: SessionUser;
		}
	}
}
