import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
	MAX_COLLECTION_SLUG_LENGTH,
	MAX_NEWS_TITLE_LENGTH,
	MAX_TAGS_PER_IMAGE,
	MAX_TAG_LENGTH
} from "../config/content-limits.ts";
import {
	collectionCreateRequest,
	downloadItemFields,
	galleryImageFields,
	mapSeasonFields,
	newsDate,
	newsPostFields
} from "./write-schemas.ts";

const IMAGE = "https://i.ibb.co/abc/image.png";
const NEWS = { title: "A *new* season", content: "Hello", imageUrl: IMAGE };

// The problems a parse reports, as "path: message".
function problems(schema: z.ZodType, value: unknown): string[] {
	const result = schema.safeParse(value);
	return result.success
		? []
		: result.error.issues.map(
				(issue) => `${issue.path.join(".")}: ${issue.message}`
			);
}

describe("newsPostFields", () => {
	it("accepts a post with markdown, allowed images, and safe links", () => {
		const content = [
			"# Heading",
			`![shot](${IMAGE})`,
			"[site](https://example.com) [mail](mailto:a@b.c) [page](/news)"
		].join("\n\n");

		expect(problems(newsPostFields.full, { ...NEWS, content })).toEqual([]);
	});

	it.each([
		["raw HTML", "hi <b>there</b>", "raw HTML isn't allowed"],
		["an HTML block", "<div>\nx\n</div>", "raw HTML isn't allowed"],
		[
			"an image from another host",
			"![x](https://evil.example/x.png)",
			"images must come from an allowed image host"
		],
		[
			"a reference-style image from another host",
			"![x][r]\n\n[r]: https://evil.example/x.png",
			"images must come from an allowed image host"
		],
		[
			"a javascript: link",
			"[x](javascript:alert(1))",
			"links must be web, email, or relative addresses"
		],
		[
			"an entity-encoded javascript: link",
			"[x](javascript&#58;alert(1))",
			"links must be web, email, or relative addresses"
		],
		[
			"a protocol-relative link",
			"[x](//evil.example/x)",
			"links must be web, email, or relative addresses"
		],
		[
			"a protocol-relative link with a backslash",
			"[x](/\\evil.example/x)",
			"links must be web, email, or relative addresses"
		],
		[
			"nesting deep enough to overflow",
			"> ".repeat(5000),
			"is nested too deeply"
		]
	])("rejects content with %s", (_name, content, message) => {
		expect(problems(newsPostFields.full, { ...NEWS, content })).toEqual([
			`content: ${message}`
		]);
	});

	it.each([
		[
			"an image",
			`Look ![x](${IMAGE})`,
			"only inline formatting is allowed"
		],
		["a line break", "One\nTwo", "line breaks aren't allowed"],
		["raw HTML", "A <i>title</i>", "raw HTML isn't allowed"]
	])("rejects a title with %s", (_name, title, message) => {
		expect(problems(newsPostFields.full, { ...NEWS, title })).toEqual([
			`title: ${message}`
		]);
	});

	it("rejects an image URL outside the allowlist, without echoing it", () => {
		const imageUrl = "https://evil.example/secret-value.png";

		const found = problems(newsPostFields.full, { ...NEWS, imageUrl });

		expect(found).toEqual([
			"imageUrl: must start with an allowed image host"
		]);
		expect(found.join()).not.toContain("secret-value");
	});

	it("caps lengths and requires the title and content", () => {
		expect(
			problems(newsPostFields.full, {
				title: "a".repeat(MAX_NEWS_TITLE_LENGTH + 1),
				content: ""
			})
		).toEqual([
			`title: must be at most ${MAX_NEWS_TITLE_LENGTH} characters`,
			"content: is required"
		]);
	});

	it("checks only the fields an update sends", () => {
		expect(problems(newsPostFields.patch, { content: "New" })).toEqual([]);
		expect(problems(newsPostFields.patch, { content: "<b>x</b>" })).toEqual(
			["content: raw HTML isn't allowed"]
		);
	});

	it("lets drafts miss fields and skip the allowlist, but not the caps", () => {
		expect(
			problems(newsPostFields.draft, {
				content: "<b>draft</b>",
				imageUrl: "https://elsewhere.example/x.png"
			})
		).toEqual([]);
		expect(
			problems(newsPostFields.draft, {
				title: "a".repeat(MAX_NEWS_TITLE_LENGTH + 1)
			})
		).toEqual([
			`title: must be at most ${MAX_NEWS_TITLE_LENGTH} characters`
		]);
		expect(problems(newsPostFields.draft, { title: 5 })).toHaveLength(1);
	});
});

describe("galleryImageFields", () => {
	const IMAGE_FIELDS = {
		collection: "season5",
		caption: "Spawn",
		imageUrl: IMAGE
	};

	it("normalises tags: lowercase, trimmed, unique, sorted", () => {
		const parsed = galleryImageFields.full.parse({
			...IMAGE_FIELDS,
			tags: [" Spawn", "build 2", "spawn", ""]
		});

		expect(parsed.tags).toEqual(["build 2", "spawn"]);
	});

	it("rejects an empty image URL", () => {
		expect(
			problems(galleryImageFields.full, { ...IMAGE_FIELDS, imageUrl: "" })
		).toEqual(["imageUrl: must start with an allowed image host"]);
	});

	it.each([
		[
			"too many tags",
			Array.from({ length: MAX_TAGS_PER_IMAGE + 1 }, (_, i) => `t${i}`),
			`tags: at most ${MAX_TAGS_PER_IMAGE} tags`
		],
		[
			"too many tags, even if duplicates",
			Array.from({ length: MAX_TAGS_PER_IMAGE + 1 }, () => "t"),
			`tags: at most ${MAX_TAGS_PER_IMAGE} tags`
		],
		[
			"a long tag",
			["a".repeat(MAX_TAG_LENGTH + 1)],
			`tags.0: must be at most ${MAX_TAG_LENGTH} characters`
		],
		...["a,b", "a-b", "a_b", "é"].map((tag) => [
			`the tag ${tag}`,
			[tag],
			"tags.0: may contain only letters, digits, and spaces"
		])
	])("rejects %s", (_name, tags, message) => {
		expect(
			problems(galleryImageFields.full, { ...IMAGE_FIELDS, tags })
		).toEqual([message]);
	});

	it.each([
		["Season5", "invalid collection name"],
		["season_5", "invalid collection name"],
		["-season", "invalid collection name"],
		[
			"a".repeat(MAX_COLLECTION_SLUG_LENGTH + 1),
			`collection name must be at most ${MAX_COLLECTION_SLUG_LENGTH} characters`
		]
	])("rejects the collection slug %s", (collection, message) => {
		expect(
			problems(galleryImageFields.full, {
				...IMAGE_FIELDS,
				collection
			})
		).toEqual([`collection: ${message}`]);
	});
});

describe("downloadItemFields", () => {
	it("needs an http(s) download URL and a whole sortOrder", () => {
		expect(
			problems(downloadItemFields.full, {
				collection: "worlds",
				title: "World",
				desc: "",
				downloadUrl: "ftp://x",
				imageUrl: IMAGE,
				sortOrder: 1.5
			})
		).toEqual([
			"downloadUrl: must be an http(s) URL",
			"sortOrder: Invalid input: expected int, received number"
		]);
	});
});

describe("mapSeasonFields", () => {
	it("checks each dimension's image against the allowlist", () => {
		expect(
			problems(mapSeasonFields.full, {
				season: 8,
				imageUrl: IMAGE,
				dimensions: [
					{
						name: "overworld",
						imageUrl: "../assets/x.png",
						worldId: "s8_overworld",
						perspective: ":0:0:0:1500:0:0:0:0:"
					}
				]
			})
		).toEqual([
			"dimensions.0.imageUrl: must start with an allowed image host"
		]);
	});
});

describe("collectionCreateRequest", () => {
	it("needs a kebab-case slug and a title", () => {
		expect(
			problems(collectionCreateRequest, { slug: "Season 9", title: "" })
		).toEqual(["slug: invalid collection name", "title: is required"]);
	});
});

describe("newsDate", () => {
	it.each(["now", "2030-01-01T00:00:00.000Z", "2030-01-01T00:00:00+02:00"])(
		"accepts %s",
		(date) => {
			expect(newsDate.safeParse(date).success).toBe(true);
		}
	);

	it.each(["tomorrow", "2030-01-01", 5])("rejects %s", (date) => {
		expect(newsDate.safeParse(date).success).toBe(false);
	});
});
