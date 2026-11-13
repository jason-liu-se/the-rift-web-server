# The Rift Web Server

The REST API behind
[The Rift website](https://github.com/jason-liu-se/the-rift-website): an
Express + Mongoose app in TypeScript that serves news, gallery, and download
content from MongoDB, and logs editors in through Discord (versions in
[`package.json`](./package.json)).

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

| Variable                    | Required | Sets                                                                        |
| --------------------------- | -------- | --------------------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | Yes      | MongoDB connection URI                                                      |
| `PORT`                      | No       | Port to listen on (default `4000`, the website expects)                     |
| `FRONTEND_URL`              | Yes      | The website's origin, the only one CORS allows                              |
| `JWT_SECRET`                | Yes      | Signs sessions; 64+ characters (see [Sessions](#sessions-and-access))       |
| `DISCORD_CLIENT_ID`         | Yes      | Discord application's client ID                                             |
| `DISCORD_CLIENT_SECRET`     | Yes      | Discord application's client secret                                         |
| `DISCORD_REDIRECT_URI`      | Yes      | `<this API>/auth/discord/callback`, registered with Discord                 |
| `DISCORD_GUILD_ID`          | Yes      | The Rift's Discord server, for role grants                                  |
| `TRUST_PROXY_HOPS`          | No       | Proxies in front of the server (default `0`), so rate limits see client IPs |

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

Endpoints return JSON unless noted. Errors are `{ "error": string }` with `400`
(invalid parameters), `401` (not logged in), `404` (unknown collection or path),
`429` (too many `/auth` requests from one IP; limits in
[`src/routes/auth.ts`](./src/routes/auth.ts)), or `500` (details logged, not
returned).

| Path                         | Query                 | Returns                                      |
| ---------------------------- | --------------------- | -------------------------------------------- |
| `/news`                      | `startIndex`, `limit` | `{ items, total }`, newest first             |
| `/news/count`                |                       | `{ total }`                                  |
| `/gallery/:collection`       | `startIndex`, `limit` | `{ items, total }`                           |
| `/gallery/:collection/count` |                       | `{ total }`                                  |
| `/downloads`                 |                       | `[{ name, items }]` for every download group |
| `/downloads/:collection`     |                       | The group's items                            |
| `/health`                    |                       | `200` with an empty body                     |
| `/auth/discord`              |                       | Starts a Discord login (`302`)               |
| `/auth/discord/callback`     | From Discord          | `302` to the website (see below)             |
| `/auth/me`                   |                       | The logged-in user, or `401`                 |
| `POST /auth/logout`          |                       | `204`; clears the session cookie             |

All paths are `GET` unless a method is shown.

`startIndex` defaults to `0`; omitting `limit` returns everything after it.
Response types are in
[`src/contract/api-responses.ts`](./src/contract/api-responses.ts), which the
website copies (see its README's "API contract"). How routes and the contract
work: [api.md](./.claude/docs/api.md).

## Sessions and access

A session is a signed JWT (HS256) in an httpOnly cookie, so there's no session
store and restarts don't log anyone out. Each token is short-lived and silently
re-issued until the session ends 30 days after the Discord login (constants in
[`src/auth/session.ts`](./src/auth/session.ts)).

- **Generate `JWT_SECRET`** once per environment:
  `node -e "console.log(require('node:crypto').randomBytes(64).toString('base64url'))"`
- **Log everyone out** by replacing `JWT_SECRET` with a new one and restarting.
- **Same site required:** the API and the website must share a site (e.g.
  `api.example.com` and `example.com`). The cookie is `SameSite=Lax`, which
  browsers don't send between different sites.

**Who can log in** is set by documents in the `access-grants` collection of the
`auth` database. A user may log in if any grant matches their Discord user ID,
one of their roles in The Rift's server (`DISCORD_GUILD_ID`), or a server they
belong to. With no grants, nobody can log in. Add one in MongoDB, with IDs as
strings:

```json
{
	"subjectType": "user",
	"subjectId": "<Discord user ID>",
	"createdBy": "<your Discord user ID>",
	"createdAt": { "$date": "2026-11-12T00:00:00Z" }
}
```

`subjectType` is `user`, `role`, or `server`. **Access is only checked at
login**: re-issuing a token doesn't re-check it, so removing a grant or role
takes effect at that user's next login (at most 30 days later). To cut someone
off now, remove their grant and rotate `JWT_SECRET`.

A login ends with a redirect to the website's `/admin`, or to
`/admin/login?error=<code>`. The code says who stopped it: `access-denied` (the
user cancelled), `invalid-request` or `not-authorized` (this server rejected
it), `discord-unavailable` (Discord's API failed), or `server-error` (this
server failed). Details are only logged. See `LoginErrorCode` in the contract.

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
