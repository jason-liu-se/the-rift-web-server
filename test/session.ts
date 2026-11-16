// A logged-in editor, for tests of routes that need one.
import { signSession } from "../src/auth/session.ts";
import { SESSION_COOKIE } from "../src/auth/session-cookie.ts";
import type { SessionUser } from "../src/contract/api-responses.ts";
import { testConfig } from "./app.ts";

export const EDITOR: SessionUser = { id: "123", username: "editor" };

// A Cookie header value holding an access token for user, logged in now.
export async function sessionCookie(
	user: SessionUser = EDITOR,
	secret = testConfig.JWT_SECRET
): Promise<string> {
	const { token } = await signSession({ user, loginAt: Date.now() }, secret);
	return `${SESSION_COOKIE}=${token}`;
}
