---
paths:
    - "src/helpers/**/*"
    - "src/managers/**/*"
    - "src/models/**/*"
    - "test/database.ts"
---

# Database

`src/managers/mongo-manager.ts` owns the connection, the public reads, the
content version, and access grants; `src/managers/editor-content.ts` the editor
tools' queries, written once for every content type from its `CONTENT_TYPES`
descriptor. Both return plain results. Routers never import models.

## Layout

Each content type has its own MongoDB database, with one schema and interface
per file in `src/models/`:

| Database    | Collections             | Model                                  |
| ----------- | ----------------------- | -------------------------------------- |
| `news`      | `posts`                 | `src/models/news-post-schema.ts`       |
| `gallery`   | `images`, `collections` | `src/models/gallery-schema.ts`         |
| `downloads` | `items`, `collections`  | `src/models/downloads-schema.ts`       |
| `maps`      | `seasons`               | `src/models/map-season-schema.ts`      |
| `auth`      | `accessGrants`          | `src/models/access-grant-schema.ts`    |
| `content`   | `meta`                  | `src/models/content-version-schema.ts` |

Editors write content through `/editor/*` (`editor-content.ts`); access grants
are added to MongoDB directly. Every committed content write then calls
`updateContentVersion` (`getContentVersion` creates the version if missing).
Updates and deletes are revision-checked in the query itself (`revisionFilter`),
so a stale write changes nothing, and writes return a `WriteResult` (`ok`,
`conflict`, `not-found`, `duplicate`) instead of throwing, so bulk actions can
report each item. Login sessions and their refresh token hashes live in Redis
instead (`src/managers/redis-manager.ts`, keys `session:<session ID>`); see
`.claude/docs/api.md` "Sessions". Discord IDs are stored as strings (numbers
lose precision).

- Collection names are used as given: pluralization and auto-creation are off.
  Models compiled on import (before `connect` turns pluralization off) pass
  their collection name as `model()`'s third argument, or Mongoose lowercases
  it.
- Galleries and download groups are entries in their database's `collections`
  (`src/models/content-collection-schema.ts`), named by a `slug` their items
  store as `collection`. Public routes check `hasPublicGalleryCollection` /
  `hasPublicDownloadCollection` first and answer `404` for a missing or hidden
  one, since a query for a missing slug just returns nothing.
- Every content document spreads `auditedFields` (`src/models/audit-fields.ts`):
  `visible`, `revision`, `createdBy` / `lastUpdatedBy`, timestamps, and the
  create's `createId`. All optional: a missing `visible` is visible, a missing
  `revision` is 0.
- Indexes are declared on the schemas. `connect` builds them and waits
  (`createIndexes`; `autoIndex` is off), so a failed build, e.g. a unique index
  over duplicate data, stops the server starting. `test/database.ts` rebuilds
  them after each drop.
- User-supplied collection names go through `collectionParams`
  (`src/api/query-schemas.ts`) before reaching `mongo-manager`.

## Query rules

- Keep reads bounded and paginated where a collection can grow.
- Let MongoDB filter, sort, and paginate, not JavaScript.
- No query per item: one query, or `Promise.all` for independent ones.
- Reads are `.lean()`, which skips Mongoose's `id` virtual, so content reads map
  `_id` to the contract's hex-string `id` with `withId`.
