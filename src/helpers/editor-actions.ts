// What the editor routes do around editor-content's queries: who's asking,
// and the errors they answer with.
import type { Response } from "express";
import { NotFoundError } from "../errors/not-found-error.ts";
import { UnauthorizedError } from "../errors/unauthorized-error.ts";
import type { ContentTypeName } from "../managers/editor-content.ts";

// What each type's item is called in messages.
const ITEM_NAMES: Readonly<Record<ContentTypeName, string>> = {
	news: "news post",
	gallery: "gallery image",
	downloads: "download item",
	maps: "map season"
};

// The logged-in editor's ID. requireLogin makes sure there is one; throwing
// keeps an ownership filter from ever silently matching everyone.
export function currentEditorId(res: Response): string {
	const id = res.locals.user?.id;
	if (id === undefined) {
		throw new UnauthorizedError();
	}
	return id;
}

export function itemNotFound(
	typeName: ContentTypeName,
	id: string
): NotFoundError {
	return new NotFoundError(`${ITEM_NAMES[typeName]} '${id}'`);
}
