# The Rift Web Server

The read-only REST API behind
[The Rift website](https://github.com/jason-liu-se/the-rift-website): an
Express + Mongoose app in TypeScript that serves news, gallery, and download
content from MongoDB (versions in [`package.json`](./package.json)).

## Requirements

- **Node.js** at the version in [`.nvmrc`](./.nvmrc) and **npm 11+**. Keep the
  base image in the [`Dockerfile`](./Dockerfile) on the same major: hosts that
  build from it use its Node version, not `.nvmrc`'s.
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
| `npm run docker:build`    | Build the Docker image (see [Docker](#docker)) |
| `npm run docker:start`    | Run the image with the variables from `.env`   |
| `npm test` / `test:watch` | Tests (no `.env` or database needed)           |
| `npm run typecheck`       | Type-check source, tests, and configs          |
| `npm run lint` / `format` | ESLint / Prettier (`lint:fix`, `format:check`) |

Tests run against an in-memory MongoDB; the first run downloads its binary.
Details: [testing.md](./.claude/rules/testing.md).

## Docker

The [`Dockerfile`](./Dockerfile) builds a production image that runs the
compiled server as a non-root user. `.env` isn't copied into the image; pass the
environment variables at run time.

```bash
npm run docker:build   # build the image
npm run docker:start   # run it on port 4000 with the variables from .env
```

`docker:start` always uses port 4000 and ignores `PORT` in `.env`. From inside
the container, `localhost` is the container itself: reach a MongoDB running on
your machine at `host.docker.internal`.

## CI

`.github/workflows/ci.yml` runs lint, the format check, the type check, and the
tests on every pull request and push to `main`. Make its `check` job a required
status check on `main` (GitHub branch protection) so only passing code merges.

## Endpoints

All endspoints use `GET` and return JSON (except `/health`'s empty body). Errors
are `{ "error": string }` with `400` (invalid parameters), `404` (unknown
collection or path), or `500` (details logged, not returned).

| Path                         | Query                 | Returns                                      |
| ---------------------------- | --------------------- | -------------------------------------------- |
| `/news`                      | `startIndex`, `limit` | `{ items, total }`, newest first             |
| `/news/count`                |                       | `{ total }`                                  |
| `/gallery/:collection`       | `startIndex`, `limit` | `{ items, total }`                           |
| `/gallery/:collection/count` |                       | `{ total }`                                  |
| `/downloads`                 |                       | `[{ name, items }]` for every download group |
| `/downloads/:collection`     |                       | The group's items                            |
| `/health`                    |                       | `200` with an empty body                     |

`startIndex` defaults to `0`; omitting `limit` returns everything after it.
Response types are in
[`src/contract/api-responses.ts`](./src/contract/api-responses.ts), which the
website copies (see its README's "API contract"). How routes and the contract
work: [api.md](./.claude/docs/api.md).

## Data

Each content type has its own database: `news` (collection `news-items`),
`gallery` (one collection per gallery), and `downloads` (one per download
group). Add content in MongoDB directly; a new gallery or download group is just
a new collection. Details: [database.md](./.claude/rules/database.md).

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
