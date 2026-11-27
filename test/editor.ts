// Requests from a logged-in editor on the website: the session cookie, and
// for writes the website's Origin (CSRF check). Each call builds its own app,
// so its rate-limit counts start at zero: call it per test (beforeEach).
import request from "supertest";
import { createApp } from "../src/app.ts";
import { testConfig } from "./app.ts";
import { sessionCookie } from "./session.ts";
import type { SessionUser } from "../src/contract/api-responses.ts";

export async function asEditor(user?: SessionUser) {
	const app = createApp(testConfig);
	const cookie = await sessionCookie(user);
	const write = (method: "post" | "put" | "patch" | "delete", url: string) =>
		request(app)
			[method](url)
			.set("Cookie", cookie)
			.set("Origin", testConfig.FRONTEND_URL);

	return {
		get: (url: string) => request(app).get(url).set("Cookie", cookie),
		post: (url: string, body?: object) => write("post", url).send(body),
		put: (url: string, body?: object) => write("put", url).send(body),
		patch: (url: string, body?: object) => write("patch", url).send(body),
		delete: (url: string, body?: object) => write("delete", url).send(body)
	};
}
