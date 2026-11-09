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

The server loads these from `.env` in the repository root. It exits with an
error if `MONGODB_CONNECTION_STRING` is missing or MongoDB is unreachable.

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
│   ├── helpers/
│   │   └── mongo-manager.ts  MongoDB connection and all database queries
│   ├── models/               Mongoose schemas and types, one file per database
│   ├── routes/               Express routers, one file per URL prefix
│   ├── app.ts                Express app: CORS headers and router mounting
│   └── index.ts              Entry point: connects to MongoDB and starts listening
├── test/                     Shared test helpers
└── dist/                     Build output (git-ignored)
```

## Architecture

`src/app.ts` builds the Express app: it sets the CORS headers and mounts one
Express router per URL prefix from `src/routes/`. `src/index.ts` connects to
MongoDB through `src/helpers/mongo-manager.ts` and starts the app listening.
Keeping the two apart lets the tests run the app without opening a port.

The API is public and read-only, so CORS allows any origin
(`Access-Control-Allow-Origin: *`).

Routers parse query parameters and call `mongo-manager`, which owns every
database query and returns plain results to the router. Routers do not query
Mongoose models directly.

### Endpoints

| Method and path                       | Query parameters                               | Returns                                                              |
| ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `GET /news/get-items`                 | `startIndex`, `limit`                          | News items, newest first                                             |
| `GET /news/count-items`               |                                                | `{ "count": number }`                                                |
| `GET /gallery/get-collection`         | `collection` (required), `startIndex`, `limit` | Images in a gallery collection                                       |
| `GET /gallery/count-collection-items` | `collection` (required)                        | `{ "count": number }`                                                |
| `GET /downloads/get-collection`       | `collection` (required)                        | Items in a download collection                                       |
| `GET /downloads/get-all`              |                                                | `[{ "name": string, "items": [...] }]` for every download collection |

`startIndex` defaults to `0`. Omitting `limit` returns every item from
`startIndex` onwards. A missing `collection` returns a JSON object with an
`error` field. If a query fails, the endpoint responds `500` with
`{ "error": string }` and logs the details to the server console.

### Data model

Each content type lives in its own MongoDB database, with schemas in
`src/models/`:

| Database    | Collections                                       | Schema                           |
| ----------- | ------------------------------------------------- | -------------------------------- |
| `news`      | `news-items`                                      | `src/models/news-schema.ts`      |
| `gallery`   | One per gallery, named by the website             | `src/models/gallery-schema.ts`   |
| `downloads` | One per download group, all returned by `get-all` | `src/models/downloads-schema.ts` |

Collection names are used as-is (pluralization is off), and the server does not
create collections, so a new gallery or download group is added by creating its
collection in MongoDB.

## Troubleshooting

### Endpoints return empty lists

Unknown collections return an empty list rather than an error. Confirm that the
database and collection names match the [data model](#data-model).

### Endpoints return 500 errors

The query failed. The server console logs the request and the underlying error.
