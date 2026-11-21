// Checks news markdown before it's saved. The website renders it with the same
// `marked` version (pinned in package.json), so these are the tokens it will
// render: a regex would miss reference-style images and raw HTML. Only checks;
// the stored text is what the editor wrote.
import { Lexer, Marked, type Token } from "marked";
import { IMAGE_URL_PREFIXES } from "../config/images.ts";

const marked = new Marked();

// A link may go to the web or an email address, or be relative. A relative
// one can't contain `:` or `&`, so neither `javascript:` nor its
// entity-encoded form (`javascript&#58;`), which browsers decode, gets
// through.
const SAFE_LINK = /^(https?:\/\/|mailto:)|^[^:&]*$/i;

export function isAllowedImageUrl(url: string): boolean {
	return IMAGE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

// Why a token can't be saved, or undefined when it can.
function tokenProblem(token: Token): string | undefined {
	switch (token.type) {
		case "html":
			return "raw HTML isn't allowed";
		case "image":
			return isAllowedImageUrl(token.href)
				? undefined
				: "images must come from an allowed image host";
		case "link":
			return SAFE_LINK.test(token.href)
				? undefined
				: "links must be web, email, or relative addresses";
		default:
			return undefined;
	}
}

function firstProblem(tokens: Token[]): string | undefined {
	const problems: string[] = [];
	marked.walkTokens(tokens, (token) => {
		const problem = tokenProblem(token);
		if (problem) {
			problems.push(problem);
		}
	});
	return problems[0];
}

// For news content: any markdown but raw HTML, unsafe links, and images from
// hosts outside IMAGE_URL_PREFIXES.
export function markdownProblem(markdown: string): string | undefined {
	return firstProblem(marked.lexer(markdown));
}

// For news titles: inline markdown (emphasis, code, links) only, so no
// images, headings, or line breaks.
export function inlineMarkdownProblem(markdown: string): string | undefined {
	if (/[\r\n]/.test(markdown)) {
		return "line breaks aren't allowed";
	}
	const tokens = Lexer.lexInline(markdown);
	const problems: string[] = [];
	marked.walkTokens(tokens, (token) => {
		if (token.type === "image" || token.type === "br") {
			problems.push("only inline formatting is allowed");
		}
	});
	return problems[0] ?? firstProblem(tokens);
}
