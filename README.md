# The Rift Web Server

REST API for
[The Rift website](https://github.com/jason-liu-se/the-rift-website): news,
gallery, and download content from MongoDB, plus Discord login for editors.
Express + Mongoose in TypeScript.

## Requirements

- Node.js at the version in [`.nvmrc`](./.nvmrc) (keep the
  [`Dockerfile`](./Dockerfile)'s base image on the same major), npm 11+
- MongoDB
- Redis (login sessions); enable persistence (AOF) in production, or a Redis
  restart logs everyone out

## Getting started

Create a `.env` file (below), then:

```bash
npm ci
npm run dev   # http://localhost:4000
```

## Environment variables

Checked at startup by [`src/config/env.ts`](./src/config/env.ts).

| Variable                    | Required | Sets                                                            |
| --------------------------- | -------- | --------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | Yes      | MongoDB connection URI                                          |
| `REDIS_URL`                 | Yes      | Redis URL (`redis://` or `rediss://`)                           |
| `PORT`                      | No       | Port (default `4000`, which the website expects)                |
| `FRONTEND_URL`              | Yes      | The website's origin (CORS, login redirects)                    |
| `JWT_SECRET`                | Yes      | 64+ characters; see [Sessions and access](#sessions-and-access) |
| `DISCORD_CLIENT_ID`         | Yes      | Discord application's client ID                                 |
| `DISCORD_CLIENT_SECRET`     | Yes      | Discord application's client secret                             |
| `DISCORD_REDIRECT_URI`      | Yes      | `<this API>/auth/discord/callback`, registered with Discord     |
| `DISCORD_GUILD_ID`          | Yes      | The Rift's Discord server, for role grants                      |
| `TRUST_PROXY_HOPS`          | No       | Proxies in front of the server (default `0`), for rate limiting |

## Commands

| Command                   | What it does                                   |
| ------------------------- | ---------------------------------------------- |
| `npm run dev`             | Run the source, restarting on changes          |
| `npm run build` / `start` | Compile to `dist/` / run the build             |
| `npm run docker:build`    | Build the Docker image                         |
| `npm run docker:start`    | Run the image on port 4000 with `.env`         |
| `npm test` / `test:watch` | Tests (no `.env`, database, or Redis needed)   |
| `npm run typecheck`       | Type-check source, tests, and configs          |
| `npm run lint` / `format` | ESLint / Prettier (`lint:fix`, `format:check`) |

In Docker, reach MongoDB or Redis on your machine at `host.docker.internal`.

CI (`.github/workflows/ci.yml`) runs lint, format, typecheck, and tests; make
its `check` job a required status check on `main`.

## Endpoints

| Endpoint                         | Query                 | Returns                                  |
| -------------------------------- | --------------------- | ---------------------------------------- |
| `GET /news`                      | `startIndex`, `limit` | `{ items, total }`, newest first         |
| `GET /news/count`                |                       | `{ total }`                              |
| `GET /gallery/:collection`       | `startIndex`, `limit` | `{ items, total }`                       |
| `GET /gallery/:collection/count` |                       | `{ total }`                              |
| `GET /downloads`                 |                       | `[{ name, items }]` for every group      |
| `GET /downloads/:collection`     |                       | The group's items                        |
| `GET /health`                    |                       | `200`                                    |
| `GET /auth/discord`              |                       | Starts a Discord login                   |
| `GET /auth/discord/callback`     | From Discord          | Redirects to the website                 |
| `GET /auth/me`                   |                       | The logged-in user, or `401`             |
| `POST /auth/refresh`             |                       | `204` with new session cookies, or `401` |
| `POST /auth/logout`              |                       | `204`                                    |

Errors are `{ "error": string }`. Response types:
[`src/contract/api-responses.ts`](./src/contract/api-responses.ts), which the
website copies (see its README's "API contract"). How routes, errors, and
sessions work: [api.md](./.claude/docs/api.md).

## Sessions and access

Logins use a short-lived JWT (`session`) plus a periodically rotating refresh
token (`refresh_token`), used for generating JWTs, stored in Redis; sessions
last 30 days ([`src/auth/`](./src/auth/)).

- **Generate `JWT_SECRET`:**
  `node -e "console.log(require('node:crypto').randomBytes(64).toString('base64url'))"`
- **Same site:** the API and website must share a site (e.g. `api.example.com`
  and `example.com`), or browsers won't send the cookies.
- **Register** `DISCORD_REDIRECT_URI` under OAuth2 → Redirects in the Discord
  application.
- **Log everyone out:** delete the `session:*` keys in Redis (and rotate
  `JWT_SECRET` to end access tokens immediately).

**Who can log in:** documents in the `auth` database's `access-grants`
collection, matching a Discord user ID or a role in The Rift's server. No grants
means nobody can log in. Access is checked only at login.

```json
{
	"subjectType": "user",
	"subjectId": "<Discord user ID, or role ID with subjectType: role>",
	"createdBy": "<your Discord user ID>",
	"createdAt": { "$date": "2026-11-12T00:00:00Z" }
}
```

## Data

**MongoDB:** databases `news` (collection `news-items`), `gallery` (one
collection per gallery), `downloads` (one per group), and `auth`
(`access-grants`). Add content directly. See
[database.md](./.claude/rules/database.md).

**Redis:** one hash per login session, key `session:<session ID>`, expiring with
the session; fields in
[`src/auth/refresh-tokens.ts`](./src/auth/refresh-tokens.ts).

## Project structure

```text
src/
├── auth/         Discord login, tokens, cookies
├── config/       Environment variables
├── contract/     Response types shared with the website
├── errors/       Errors mapped to status codes
├── helpers/      MongoDB, Redis, and Discord access
├── middleware/   CORS, sessions, error handler
├── models/       Mongoose schemas
├── routes/       Routers and request/response schemas
├── app.ts        Builds the Express app
└── index.ts      Entry point
test/             Test helpers
```

## Troubleshooting

| Problem                      | Check                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Exits on startup             | The listed `.env` variables; MongoDB and Redis are up |
| `404` for a gallery/download | The collection exists in the right database           |
| `500` errors                 | The server console                                    |
| Login fails                  | The `error` code on `/admin/login` and the console    |
