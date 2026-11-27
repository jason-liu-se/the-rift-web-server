// The gallery's tags in the editor tools (/editor/gallery/tags; needs a
// login): for its tag filter and suggestions, including tags only on hidden
// images or the editor's own drafts. `no-store` (the default), like drafts.
import express from "express";
import { editorOf } from "../../helpers/editor-actions.ts";
import * as draftsManager from "../../managers/drafts.ts";
import * as editorContent from "../../managers/editor-content.ts";
import { editorTagsQuery, normaliseTags } from "../../api/query-schemas.ts";
import {
	editorGalleryTags,
	parseResponse
} from "../../api/response-schemas.ts";

export const editorGalleryTagsRouter = express.Router();

editorGalleryTagsRouter.get("/", async (req, res) => {
	const { q = "" } = editorTagsQuery.parse(req.query);

	const [imageTags, draftTags] = await Promise.all([
		editorContent.getGalleryTags(q),
		draftsManager.getDraftTags(editorOf(res).id, q)
	]);
	res.json(
		parseResponse(
			editorGalleryTags,
			normaliseTags([...imageTags, ...draftTags])
		)
	);
});
