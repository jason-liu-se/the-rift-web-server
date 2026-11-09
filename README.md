# The Rift Web Server

The Rift web server is the REST API behind
[The Rift website](https://github.com/jason-liu-se/the-rift-website) for the
Minecraft server community. It is a Node.js application written in TypeScript
with Express and Mongoose, and it serves news, gallery, and download content
stored in MongoDB.

The server is read-only (for now): every endpoint is a `GET` that returns JSON.
Content is added to MongoDB directly; see [Data model](#data-model).

## Requirements

- Node.js at the version in [`.nvmrc`](./.nvmrc) (run `nvm use`)
- npm 11.x
- A MongoDB instance reachable from the server (local or hosted, e.g. Atlas)

## Getting started

Create a `.env` file in the repository root with the
[environment variables](#environment-variables) below, then run:

```bash
npm ci
npm run dev
```

The server listens on <http://localhost:4000/> by default. `npm run dev` runs
the TypeScript source directly and restarts on changes. To run it as in
production, build first:

```bash
npm run build
npm start
```

### Environment variables

The server loads these from `.env` in the repository root and validates them at
startup against the schema in `src/config/env.ts`. It exits listing every
invalid variable, or if MongoDB is unreachable.

| Variable                    | Required | Description                                                               |
| --------------------------- | -------- | ------------------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | Yes      | MongoDB connection URI.                                                   |
| `PORT`                      | No       | Port to listen on. Defaults to `4000`, which the website expects locally. |

## Npm scripts

| Command                | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `npm run dev`          | Run `src/index.ts` directly, restarting on changes.   |
| `npm run build`        | Compile `src/` to JavaScript in `dist/`.              |
| `npm start`            | Start the built server from `dist/index.js`.          |
| `npm run typecheck`    | Type-check the source, tests, and configs with `tsc`. |
| `npm test`             | Run the tests once with Vitest.                       |
| `npm run test:watch`   | Re-run the tests as files change.                     |
| `npm run lint`         | Check the code with ESLint.                           |
| `npm run lint:fix`     | Fix ESLint problems that can be fixed automatically.  |
| `npm run format`       | Format every file with Prettier.                      |
| `npm run format:check` | Check formatting without writing changes.             |

A Husky pre-commit hook runs ESLint and Prettier on staged files. Formatting
rules live in `.prettierrc` and `.editorconfig`; lint rules in
`eslint.config.js`; compiler options in `tsconfig.json` (type-checking) and
`tsconfig.build.json` (the `dist/` build).

## Testing

Run the tests with:

```bash
npm test
```

The tests are integration tests:
[Supertest](https://github.com/forwardemail/supertest) sends real HTTP requests
to the Express app from `src/app.ts`, which runs against a temporary in-memory
MongoDB from
[mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server). No
`.env` or running database is needed. The first run downloads a MongoDB binary
(about 80 MB) and caches it.

Test files sit next to the code they cover as `*.test.ts`. Shared helpers for
starting, seeding, and clearing the database live in `test/database.ts`.

## Project structure

```text
.
├── src/
│   ├── config/
│   │   └── env.ts            Environment variable schema
│   ├── errors/               Error classes the error handler maps to status codes
│   ├── helpers/
│   │   └── mongo-manager.ts  MongoDB connection and all database queries
│   ├── models/               Mongoose schemas and types, one file per database
│   ├── routes/               Express routers, one per URL prefix, request schemas,
│   │                         and the deprecated routes (legacy.ts)
│   ├── app.ts                Express app: CORS headers and router mounting
│   └── index.ts              Entry point: connects to MongoDB and starts listening
├── test/                     Shared test helpers
└── dist/                     Build output (git-ignored)
```

## Architecture

`src/app.ts` builds the Express app: it sets the CORS headers, mounts the
deprecated routes from `src/routes/legacy.ts`, then one Express router per URL
prefix from `src/routes/`. `src/index.ts` connects to MongoDB through
`src/helpers/mongo-manager.ts` and starts the app listening. Keeping the two
apart lets the tests run the app without opening a port.

The API is public and read-only, so CORS allows any origin
(`Access-Control-Allow-Origin: *`).

Routers parse path and query parameters and call `mongo-manager`, which owns
every database query and returns plain results to the router. Routers do not
query Mongoose models directly.

On `SIGTERM` or `SIGINT` (Ctrl+C), `src/index.ts` shuts down gracefully: it
stops accepting connections, lets in-flight requests finish, and disconnects
from MongoDB. If that takes longer than the timeout in `src/index.ts`, it forces
the exit. Pressing Ctrl+C a second time exits immediately.

### Endpoints

| Method and path                  | Query parameters      | Returns                                                                       |
| -------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `GET /news`                      | `startIndex`, `limit` | `{ "items": [...], "total": number }`, news items newest first                |
| `GET /news/count`                |                       | `{ "total": number }`, without fetching any items                             |
| `GET /gallery/:collection`       | `startIndex`, `limit` | `{ "items": [...], "total": number }`, images in a gallery collection         |
| `GET /gallery/:collection/count` |                       | `{ "total": number }`, without fetching any images                            |
| `GET /downloads`                 |                       | `[{ "name": string, "items": [...] }]` for every download collection, by name |
| `GET /downloads/:collection`     |                       | Items in a download collection                                                |

`startIndex` defaults to `0`. Omitting `limit` returns every item from
`startIndex` onwards; `total` counts the whole collection. Use the `/count`
endpoints when only the size is needed. Path and query parameters are validated
with the Zod schemas in `src/routes/query-schemas.ts`.

#### Deprecated endpoints

These predate the routes above and stay until the website switches over. They
take the collection as a query parameter, return bare arrays, and answer an
unknown collection with an empty list instead of `404`.

| Method and path                       | Query parameters                               | Use instead                      |
| ------------------------------------- | ---------------------------------------------- | -------------------------------- |
| `GET /news/get-items`                 | `startIndex`, `limit`                          | `GET /news` (`items`)            |
| `GET /news/count-items`               |                                                | `GET /news/count`                |
| `GET /gallery/get-collection`         | `collection` (required), `startIndex`, `limit` | `GET /gallery/:collection`       |
| `GET /gallery/count-collection-items` | `collection` (required)                        | `GET /gallery/:collection/count` |
| `GET /downloads/get-collection`       | `collection` (required)                        | `GET /downloads/:collection`     |
| `GET /downloads/get-all`              |                                                | `GET /downloads`                 |

Errors respond with `{ "error": string }`:

- `400` when path or query parameters are missing or invalid, e.g. a collection
  name MongoDB doesn't allow, or a negative or non-integer `startIndex`/`limit`.
- `404` when the collection doesn't exist, or no endpoint matches the method and
  path.
- `500` when a query fails. The details are logged to the server console, not
  returned.

### Data model

Each content type lives in its own MongoDB database, with schemas in
`src/models/`:

| Database    | Collections                                              | Schema                           |
| ----------- | -------------------------------------------------------- | -------------------------------- |
| `news`      | `news-items`                                             | `src/models/news-schema.ts`      |
| `gallery`   | One per gallery, named by the website                    | `src/models/gallery-schema.ts`   |
| `downloads` | One per download group, all returned by `GET /downloads` | `src/models/downloads-schema.ts` |

Collection names are used as-is (pluralization is off), and the server does not
create collections, so a new gallery or download group is added by creating its
collection in MongoDB.

## Troubleshooting

### Endpoints return empty lists

Unknown collections return an empty list rather than an error. Confirm that the
database and collection names match the [data model](#data-model).

### Endpoints return 500 errors

The query failed. The server console logs the request and the underlying error.
