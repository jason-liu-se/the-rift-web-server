import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi
} from "vitest";
import request from "supertest";
import { createApp } from "../../app.ts";
import { MAX_UPLOAD_BYTES } from "../../config/uploads.ts";
import { testConfig } from "../../../test/app.ts";
import { sessionCookie } from "../../../test/session.ts";

// Real enough to pass the type check: each starts with its format's magic
// number.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const GIF = Buffer.from("GIF89a....");
const WEBP = Buffer.concat([
	Buffer.from("RIFF"),
	Buffer.alloc(4),
	Buffer.from("WEBPVP8 ")
]);
const TEXT = Buffer.from("just some text");

let app: ReturnType<typeof createApp>;
let cookie = "";
let imgbb: MockInstance<typeof fetch>;

beforeEach(async () => {
	app = createApp(testConfig);
	cookie = await sessionCookie();
	let uploads = 0;
	imgbb = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
		uploads += 1;
		return Response.json({
			data: { url: `https://i.ibb.co/x/${uploads}.png` }
		});
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function upload() {
	return request(app)
		.post("/editor/images")
		.set("Cookie", cookie)
		.set("Origin", testConfig.FRONTEND_URL);
}

describe("POST /editor/images", () => {
	it("answers 401 logged out and 403 without the website's Origin", async () => {
		await request(app)
			.post("/editor/images")
			.set("Origin", testConfig.FRONTEND_URL)
			.attach("files", PNG, "a.png")
			.expect(401);
		await request(app)
			.post("/editor/images")
			.set("Cookie", cookie)
			.attach("files", PNG, "a.png")
			.expect(403);
		expect(imgbb).not.toHaveBeenCalled();
	});

	it("uploads each image to imgbb, named for its gallery", async () => {
		const res = await upload()
			.field("album", "gallery")
			.field("collection", "season5")
			.attach("files", PNG, "Spawn Area.PNG")
			.attach("files", WEBP, "castle.webp")
			.expect(200);

		expect(res.body).toEqual({
			results: [
				{
					name: "g-season5-spawn-area",
					url: "https://i.ibb.co/x/1.png"
				},
				{ name: "g-season5-castle", url: "https://i.ibb.co/x/2.png" }
			]
		});
		const [url, init] = imgbb.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://api.imgbb.com/1/upload?key=test-imgbb-key"
		);
		expect((init?.body as FormData).get("name")).toBe(
			"g-season5-spawn-area"
		);
		expect(JSON.stringify(res.body)).not.toContain("test-imgbb-key");
	});

	it.each([
		["news", "n-"],
		["downloads", "d-"],
		["maps", "m-"]
	])("prefixes %s uploads with %s", async (album, prefix) => {
		const res = await upload()
			.field("album", album)
			.attach("files", GIF, "banner.gif")
			.expect(200);

		expect(res.body.results[0].name).toBe(`${prefix}banner`);
	});

	it("refuses a file that isn't an image, whatever its name", async () => {
		const res = await upload()
			.field("album", "news")
			.attach("files", TEXT, "fake.png")
			.attach("files", PNG, "real.png")
			.expect(200);

		expect(res.body.results).toEqual([
			{ name: "n-fake", error: "not a PNG, JPEG, WebP, or GIF image" },
			{ name: "n-real", url: "https://i.ibb.co/x/1.png" }
		]);
		expect(imgbb).toHaveBeenCalledTimes(1);
	});

	it("reports imgbb's failures generically, logging the details without the key", async () => {
		imgbb.mockResolvedValueOnce(
			Response.json(
				{ error: { message: "Invalid API key" } },
				{ status: 400 }
			)
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		const res = await upload()
			.field("album", "news")
			.attach("files", PNG, "a.png")
			.expect(200);

		expect(res.body.results).toEqual([
			{ name: "n-a", error: "the image host failed; try again" }
		]);
		const logged = String(consoleError.mock.calls[0]);
		expect(logged).toMatch(/400 \(Invalid API key\)/);
		expect(logged).not.toContain("test-imgbb-key");
	});

	it("reports an unreachable imgbb generically", async () => {
		imgbb.mockRejectedValueOnce(new TypeError("fetch failed"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const res = await upload()
			.field("album", "news")
			.attach("files", PNG, "a.png")
			.expect(200);

		expect(res.body.results[0].error).toBe(
			"the image host failed; try again"
		);
	});

	it("answers 413 for a file over the size limit", async () => {
		const res = await upload()
			.field("album", "news")
			.attach("files", Buffer.alloc(MAX_UPLOAD_BYTES + 1), "big.png")
			.expect(413);

		expect(res.body).toEqual({ error: "ERROR: an image is too large" });
	});

	it("answers 400 for more than 20 files", async () => {
		let req = upload().field("album", "news");
		for (let i = 0; i < 21; i += 1) {
			req = req.attach("files", PNG, `${i}.png`);
		}

		await req.expect(400);
		expect(imgbb).not.toHaveBeenCalled();
	});

	it.each([
		[
			"no files",
			(req: request.Test) => req.field("album", "news"),
			/at least one image/
		],
		[
			"no album",
			(req: request.Test) => req.attach("files", PNG, "a.png"),
			/album/
		],
		[
			"a gallery upload without a collection",
			(req: request.Test) =>
				req.field("album", "gallery").attach("files", PNG, "a.png"),
			/collection/
		]
	])("answers 400 for %s", async (_name, build, message) => {
		const res = await build(upload()).expect(400);

		expect(res.body.error).toMatch(message);
	});

	it("uploads through the path however Express routes it", async () => {
		await request(app)
			.post("/Editor/Images/")
			.set("Cookie", cookie)
			.set("Origin", testConfig.FRONTEND_URL)
			.field("album", "news")
			.attach("files", PNG, "a.png")
			.expect(200);
	});

	it("answers 400 for a malformed multipart body", async () => {
		const res = await upload()
			.set("Content-Type", "multipart/form-data; boundary=x")
			.send(
				'--x\r\nContent-Disposition: form-data; name="album"\r\n\r\nnews'
			)
			.expect(400);

		expect(res.body).toEqual({ error: "ERROR: malformed multipart body" });
	});

	it("reports an image URL the allowlist wouldn't accept as a failure", async () => {
		imgbb.mockResolvedValueOnce(
			Response.json({ data: { url: "https://elsewhere.example/a.png" } })
		);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const res = await upload()
			.field("album", "news")
			.attach("files", PNG, "a.png")
			.expect(200);

		expect(res.body.results[0].error).toBe(
			"the image host failed; try again"
		);
	});

	it("still refuses multipart bodies on other routes", async () => {
		await request(app)
			.post("/editor/news")
			.set("Cookie", cookie)
			.set("Origin", testConfig.FRONTEND_URL)
			.attach("files", PNG, "a.png")
			.expect(415);
	});
});
