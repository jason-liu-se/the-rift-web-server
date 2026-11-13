---
paths:
    - "src/helpers/**/*"
    - "src/models/**/*"
    - "test/database.ts"
---

# Database

`src/helpers/mongo-manager.ts` owns the connection and every query, and returns
plain results. Routers never import models.

## Layout

Each content type has its own MongoDB database, with one schema and interface
per file in `src/models/`:

| Database    | Collections            | Model                               |
| ----------- | ---------------------- | ----------------------------------- |
| `news`      | `news-items`           | `src/models/news-schema.ts`         |
| `gallery`   | One per gallery        | `src/models/gallery-schema.ts`      |
| `downloads` | One per download group | `src/models/downloads-schema.ts`    |
| `auth`      | `access-grants`        | `src/models/access-grant-schema.ts` |

Content and access grants are added to MongoDB directly; the server never
writes. Login sessions and their refresh token hashes live in Redis instead
(`src/helpers/redis-manager.ts`, keys `session:<session ID>`); see
`.claude/docs/api.md` "Sessions". Discord IDs are stored as strings (numbers
lose precision).

- Collection names are used as given: pluralization and auto-creation are off. A
  new gallery or download group is just a new collection.
- A query against an unknown collection returns nothing, so routes check
  `hasGalleryCollection` / `hasDownloadCollection` first and answer `404`.
- User-supplied collection names go through `collectionParams`
  (`src/routes/query-schemas.ts`) before reaching `mongo-manager`.

## Query rules

- Keep reads bounded and paginated where a collection can grow.
- Let MongoDB filter, sort, and paginate, not JavaScript.
- No query per item: one query, or `Promise.all` for independent ones.
- Reads are `.lean()`, which skips Mongoose's `id` virtual, so content reads map
  `_id` to the contract's hex-string `id` with `withId`.
