// Drafts (/editor/drafts): an editor's unpublished work, private to them.
// Never cached (the app-wide no-store), unlike the editor's other reads. The
// save and publish logic is in src/helpers/draft-actions.ts.
import express from "express";
import {
	draftNotFound,
	getOwnDraft,
	publishDraft,
	saveDraft
} from "../../helpers/draft-actions.ts";
import * as drafts from "../../managers/drafts.ts";
import { editorOf } from "../../helpers/editor-actions.ts";
import * as mongoManager from "../../managers/mongo-manager.ts";
import {
	draftParams,
	draftPublishRequest,
	draftSaveRequest,
	draftsQuery
} from "../../api/draft-requests.ts";
import {
	draft as draftResponse,
	draftSummaries,
	parseResponse
} from "../../api/response-schemas.ts";

export const draftsRouter = express.Router();

draftsRouter.get("/", async (req, res) => {
	const { type } = draftsQuery.parse(req.query);

	res.json(
		parseResponse(
			draftSummaries,
			await drafts.listDrafts(editorOf(res).id, type)
		)
	);
});

draftsRouter.get("/:id", async (req, res) => {
	const { id } = draftParams.parse(req.params);

	const stored = await getOwnDraft(editorOf(res).id, id);
	res.json(parseResponse(draftResponse, stored));
});

// 201 when it creates the draft, else 200 (a save, or a repeated create).
draftsRouter.put("/:id", async (req, res) => {
	const { id } = draftParams.parse(req.params);
	const body = draftSaveRequest.parse(req.body);

	const { created, draft } = await saveDraft(editorOf(res).id, id, body);
	res.status(created ? 201 : 200).json(draft);
});

draftsRouter.delete("/:id", async (req, res) => {
	const { id } = draftParams.parse(req.params);

	if (!(await drafts.deleteDraft(editorOf(res).id, id))) {
		throw draftNotFound(id);
	}
	res.sendStatus(204);
});

draftsRouter.post("/:id/publish", async (req, res) => {
	const { id } = draftParams.parse(req.params);
	const options = draftPublishRequest.parse(req.body);

	const { item, wrote } = await publishDraft(editorOf(res), id, options);
	if (wrote) {
		await mongoManager.updateContentVersion();
	}
	res.json(item);
});
