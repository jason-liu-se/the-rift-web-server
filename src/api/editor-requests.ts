// Parses the editor's list queries for any content type.
import {
	CONTENT_TYPES,
	type ContentTypeName
} from "../managers/editor-content.ts";
import { editorListQuery } from "./query-schemas.ts";

// A type's list query: its statuses and search fields, and `collection` only
// for the types with collections.
export function listQueryFor(typeName: ContentTypeName) {
	const { statuses, searchFields, collectionModel } = CONTENT_TYPES[typeName];
	const schema = editorListQuery(statuses, Object.keys(searchFields));
	return collectionModel ? schema : schema.omit({ collection: true });
}
