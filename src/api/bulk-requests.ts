// The bulk action bodies (src/contract/api-requests.ts), by method and
// content type. Only what's wrong with the request as a whole (the action,
// the item count) is checked here, as a 400; each item is checked on its own
// later (src/helpers/editor-writes.ts), so one bad item doesn't refuse the
// others. Every item names itself, so its result can.
import * as z from "zod";
import { MAX_BULK_ITEMS } from "../config/requests.ts";
import type {
	BulkDeleteRequest,
	DownloadItemBulkUpdateRequest,
	GalleryImageBulkCreateRequest,
	GalleryImageBulkUpdateRequest,
	MapSeasonBulkUpdateRequest,
	NewsPostBulkUpdateRequest
} from "../contract/api-requests.ts";
import type { ContentTypeName } from "../types/editor-content.ts";
import { collectionSlug } from "./query-schemas.ts";
import { tagList } from "./write-schemas.ts";

const itemId = z.string().min(1).max(64);

function itemList<Item extends z.ZodType>(item: Item) {
	return z
		.array(item)
		.min(1, "items: at least one item")
		.max(MAX_BULK_ITEMS, `items: at most ${MAX_BULK_ITEMS} items`);
}

// Items to update or delete, and new items, each kept whole for its own
// check.
const itemRefs = itemList(z.looseObject({ id: itemId }));
const newItems = itemList(z.looseObject({ createId: itemId }));

// A loose object's input without its index signature, which no contract
// interface has.
type KnownKeys<T> = { [K in keyof T as string extends K ? never : K]: T[K] };
type WithKnownItems<T> = T extends { items: readonly (infer Item)[] }
	? Omit<T, "items"> & { items: KnownKeys<Item>[] }
	: never;
type SameUnion<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;

// A body schema that fails to compile unless it has exactly the contract
// type's actions and takes its top-level fields and each item's `id` or
// `createId`. The rest of each item is checked at run time, per item.
function bodyFor<Request>() {
	return <Schema extends z.ZodType>(
		schema: Schema &
			([Request] extends [WithKnownItems<z.input<Schema>>]
				? unknown
				: { "doesn't take what the contract sends": Request }) &
			([Request] extends [{ action: unknown }]
				? SameUnion<
						Request["action"],
						z.input<Schema> extends { action: infer Action }
							? Action
							: never
					> extends true
					? unknown
					: { "doesn't have exactly the contract's actions": Request }
				: unknown)
	) => schema;
}

// What every type's bulk update can do, then what only some types can.
const visibilityUpdate = z.object({
	action: z.enum(["show", "hide"]),
	items: itemRefs
});
const DEFAULT_UPDATES = [visibilityUpdate] as const;

const moveUpdate = z.object({
	action: z.literal("move"),
	collection: collectionSlug,
	items: itemRefs
});
const tagsUpdate = z.object({
	action: z.enum(["add-tags", "remove-tags"]),
	tags: tagList.pipe(z.array(z.string()).min(1, "at least one tag")),
	items: itemRefs
});

// Each type's bulk update: the default actions and its own (EXTRA) ones. An
// action the type doesn't have is a 400.
export const BULK_UPDATE_REQUESTS = {
	news: bodyFor<NewsPostBulkUpdateRequest>()(
		z.discriminatedUnion("action", [...DEFAULT_UPDATES])
	),
	gallery: bodyFor<GalleryImageBulkUpdateRequest>()(
		z.discriminatedUnion("action", [
			...DEFAULT_UPDATES,
			moveUpdate,
			tagsUpdate
		])
	),
	downloads: bodyFor<DownloadItemBulkUpdateRequest>()(
		z.discriminatedUnion("action", [...DEFAULT_UPDATES, moveUpdate])
	),
	maps: bodyFor<MapSeasonBulkUpdateRequest>()(
		z.discriminatedUnion("action", [...DEFAULT_UPDATES])
	)
} as const satisfies Record<ContentTypeName, z.ZodType>;

export type BulkUpdateRequest = z.infer<
	(typeof BULK_UPDATE_REQUESTS)[ContentTypeName]
>;

export const bulkDeleteRequest = bodyFor<BulkDeleteRequest>()(
	z.object({ items: itemRefs })
);

// The types with a bulk create (others have no POST /bulk).
export const BULK_CREATE_REQUESTS: Partial<
	Record<ContentTypeName, z.ZodType<{ items: { createId: string }[] }>>
> = {
	gallery: bodyFor<GalleryImageBulkCreateRequest>()(
		z.object({ items: newItems })
	)
};
