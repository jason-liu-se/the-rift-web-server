import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, testConfig } from "../../test/app.ts";
import { sessionCookie } from "../../test/session.ts";

let cookie = "";

beforeAll(async () => {
	cookie = await sessionCookie();
});

// No route accepts a body yet, so a write whose body passes answers 404.
function write() {
	return request(app)
		.delete("/news/some-id")
		.set("Origin", testConfig.FRONTEND_URL)
		.set("Cookie", cookie);
}

describe("request bodies", () => {
	it("accepts a JSON body", async () => {
		await write().send({ title: "news" }).expect(404);
	});

	it("accepts no body", async () => {
		await write().expect(404);
	});

	it("accepts an empty body without a type, as browsers send it", async () => {
		await write().set("Content-Length", "0").expect(404);
	});

	it("accepts an empty chunked body without a type", async () => {
		await write().set("Transfer-Encoding", "chunked").expect(404);
	});

	it("refuses a chunked body without a type with 415", async () => {
		const req = write().set("Transfer-Encoding", "chunked");
		req.write('{"title": "news"}');
		const res = await req.expect(415);

		expect(res.body).toEqual({
			error: "ERROR: request body must be application/json"
		});
	});

	it("refuses a body without a type with 415", async () => {
		await write()
			.set("Content-Length", "2")
			.send(Buffer.from("{}"))
			.expect(415);
	});

	it.each([
		["text", "text/plain", "hello"],
		["a form", "application/x-www-form-urlencoded", "title=news"],
		["multipart", "multipart/form-data; boundary=x", "--x--"]
	])("refuses %s with 415", async (_, type, body) => {
		const res = await write()
			.set("Content-Type", type)
			.send(body)
			.expect(415);

		expect(res.body).toEqual({
			error: "ERROR: request body must be application/json"
		});
	});

	it("refuses malformed JSON with 400, without echoing it", async () => {
		const res = await write()
			.set("Content-Type", "application/json")
			.send('{"title": secret')
			.expect(400);

		expect(res.body).toEqual({ error: "ERROR: malformed request body" });
	});

	it("refuses a body over the limit with 413", async () => {
		const res = await write()
			.send({ text: "x".repeat(200 * 1024) })
			.expect(413);

		expect(res.body).toEqual({ error: "ERROR: request body too large" });
	});

	it("refuses an unsupported charset with 415", async () => {
		const res = await write()
			.set("Content-Type", "application/json; charset=latin1")
			.send("{}")
			.expect(415);

		expect(res.body).toEqual({
			error: "ERROR: unsupported request body encoding"
		});
	});

	it("doesn't parse logged-out bodies", async () => {
		await request(app)
			.delete("/news/some-id")
			.set("Origin", testConfig.FRONTEND_URL)
			.set("Content-Type", "application/json")
			.send('{"title": secret')
			.expect(401);
	});
});

describe("response headers", () => {
	it("don't name the framework", async () => {
		const res = await request(app).get("/health").expect(200);

		expect(res.headers).not.toHaveProperty("x-powered-by");
	});
});
