// What the editor routes do around editor-content's queries: the errors they
// answer with.
import { NotFoundError } from "../errors/not-found-error.ts";
import type { ContentTypeName } from "../managers/editor-content.ts";

// What each type's item is called in messages.
const ITEM_NAMES: Readonly<Record<ContentTypeName, string>> = {
	news: "news post",
	gallery: "gallery image",
	downloads: "download item",
	maps: "map season"
};

export function itemNotFound(
	typeName: ContentTypeName,
	id: string
): NotFoundError {
	return new NotFoundError(`${ITEM_NAMES[typeName]} '${id}'`);
}
