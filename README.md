# The Rift Web Server

The read-only REST API behind
[The Rift website](https://github.com/jason-liu-se/the-rift-website): an
Express + Mongoose app in TypeScript that serves news, gallery, and download
content from MongoDB (versions in [`package.json`](./package.json)).

## Requirements

- **Node.js** at the version in [`.nvmrc`](./.nvmrc) and **npm 11+**
- A **MongoDB** instance (local or hosted)

## Getting started

Create a `.env` file (see below), then:

```bash
npm ci
npm run dev   # http://localhost:4000
```

## Environment variables

Validated at startup by `src/config/env.ts`; the server exits listing any that
are invalid.

| Variable                    | Required | Sets                                                    |
| --------------------------- | -------- | ------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | Yes      | MongoDB connection URI                                  |
| `PORT`                      | No       | Port to listen on (default `4000`, the website expects) |

## Commands

| Command                   | What it does                                   |
| ------------------------- | ---------------------------------------------- |
| `npm run dev`             | Run the source directly, restarting on changes |
| `npm run build` / `start` | Compile to `dist/` / run the build             |
| `npm test` / `test:watch` | Tests (no `.env` or database needed)           |
| `npm run typecheck`       | Type-check source, tests, and configs          |
| `npm run lint` / `format` | ESLint / Prettier (`lint:fix`, `format:check`) |

Tests run against an in-memory MongoDB; the first run downloads its binary.
Details: [testing.md](./.claude/docs/testing.md).

## Endpoints

All `GET`, all JSON. Errors are `{ "error": string }` with `400` (invalid
parameters), `404` (unknown collection or path), or `500` (details logged, not
returned).

| Path                         | Query                 | Returns                                      |
| ---------------------------- | --------------------- | -------------------------------------------- |
| `/news`                      | `startIndex`, `limit` | `{ items, total }`, newest first             |
| `/news/count`                |                       | `{ total }`                                  |
| `/gallery/:collection`       | `startIndex`, `limit` | `{ items, total }`                           |
| `/gallery/:collection/count` |                       | `{ total }`                                  |
| `/downloads`                 |                       | `[{ name, items }]` for every download group |
| `/downloads/:collection`     |                       | The group's items                            |

`startIndex` defaults to `0`; omitting `limit` returns everything after it.
Response types are in
[`src/contract/api-responses.ts`](./src/contract/api-responses.ts), which the
website copies (see its README's "API contract"). How routes and the contract
work: [api.md](./.claude/docs/api.md).

## Data

Each content type has its own database: `news` (collection `news-items`),
`gallery` (one collection per gallery), and `downloads` (one per download
group). Add content in MongoDB directly; a new gallery or download group is just
a new collection. Details: [database.md](./.claude/docs/database.md).

## Project structure

```text
src/
├── config/env.ts      Environment variable schema
├── contract/          Response types shared with the website
├── errors/            Errors the handler maps to status codes
├── helpers/           mongo-manager: connection and all queries
├── models/            Mongoose schemas, one file per database
├── routes/            Routers and request/response schemas
├── app.ts             Express app (CORS, routers, error handler)
└── index.ts           Entry point: connect, listen, shut down
test/                  Shared test helpers
```

## Troubleshooting

| Problem                      | Check                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| Exits on startup             | The listed variables in `.env`, and that MongoDB is reachable |
| `404` for a gallery/download | The collection exists in the right database                   |
| `500` errors                 | The server console, which logs the request and the error      |

## Claude Code

The repo ships shared [Claude Code](https://claude.com/claude-code) setup:
[`CLAUDE.md`](./CLAUDE.md) and [`.claude/`](./.claude/). Put personal overrides
in `.claude/settings.local.json`.
