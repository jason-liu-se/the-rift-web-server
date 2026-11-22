# The Rift Web Server

REST API for
[The Rift website](https://github.com/jason-liu-se/the-rift-website): news,
gallery, and download content from MongoDB, plus Discord login for editors.
Express + Mongoose in TypeScript.

## Requirements

- Node.js at the version in [`.nvmrc`](./.nvmrc) (keep the
  [`Dockerfile`](./Dockerfile)'s base image on the same major), npm 11+
- MongoDB
- Redis 7+ (login sessions); enable persistence (AOF) in production, or a Redis
  restart logs everyone out

## Getting started

Create a `.env` file (below), then:

```bash
npm ci
npm run dev   # http://localhost:4000
```

## Environment variables

Checked at startup by [`src/config/env.ts`](./src/config/env.ts). These hold
what differs per deployment, and secrets. Settings that are the same everywhere
but may need tuning (session lifetimes, rate limits, timeouts, the website's
login pages) are constants in the other files in [`src/config/`](./src/config/),
meant to be edited directly.

| Variable                         | Required | Sets                                                                                            |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING`      | Yes      | MongoDB connection URI                                                                          |
| `REDIS_URL`                      | Yes      | Redis URL (`redis://` or `rediss://`)                                                           |
| `PORT`                           | No       | Port (default `4000`, which the website expects)                                                |
| `FRONTEND_URL`                   | Yes      | The website's origin (CORS, login redirects)                                                    |
| `JWT_SECRET`                     | Yes      | 64+ characters; see [Sessions and access](#sessions-and-access)                                 |
| `DISCORD_CLIENT_ID`              | Yes      | Discord application's client ID                                                                 |
| `DISCORD_CLIENT_SECRET`          | Yes      | Discord application's client secret                                                             |
| `DISCORD_REDIRECT_URI`           | Yes      | `<this API>/auth/discord/callback`, registered with Discord                                     |
| `DISCORD_GUILD_ID`               | Yes      | The Rift's Discord server, for role grants                                                      |
| `TRUST_PROXY_HOPS`               | No       | Proxies in front of the server (default `0`), for rate limiting                                 |
| `BEHIND_CLOUDFLARE_TUNNEL`       | No       | `true` only behind a Cloudflare Tunnel; see [Behind Cloudflare](#behind-cloudflare)             |
| `READ_RATE_LIMIT_WITHOUT_TUNNEL` | No       | Reads per minute without the tunnel, e.g. in development (default: `src/config/rate-limits.ts`) |

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

New git worktrees get `.env` copied in by Claude Code (`.worktreeinclude`); run
`npm ci` in each, and give each `npm run dev` its own `PORT`.

CI (`.github/workflows/ci.yml`) runs lint, format, typecheck, and tests; make
its `check` job a required status check on `main`.

## Endpoints

### Public

| Endpoint                         | Query                         | Returns                                  |
| -------------------------------- | ----------------------------- | ---------------------------------------- |
| `GET /content/version`           |                               | `{ version }`, never cached              |
| `GET /content/version/:area`     |                               | `{ version }` for `news`, never cached   |
| `GET /news`                      | `startIndex`, `limit`         | `{ items, total }`, newest first         |
| `GET /news/count`                |                               | `{ total }`                              |
| `GET /gallery`                   |                               | `[{ slug, title }]`, sorted by slug      |
| `GET /gallery/:collection`       | `startIndex`, `limit`, `tags` | `{ items, total }`, newest first         |
| `GET /gallery/:collection/count` | `tags`                        | `{ total }`                              |
| `GET /gallery/:collection/tags`  |                               | The images' tags, sorted                 |
| `GET /downloads`                 |                               | `[{ name, title, items }]` per group     |
| `GET /downloads/:collection`     |                               | The group's items, by `sortOrder`        |
| `GET /maps/seasons`              |                               | Every season's map, oldest first         |
| `GET /health`                    |                               | `200`                                    |
| `GET /auth/discord`              |                               | Starts a Discord login                   |
| `GET /auth/discord/callback`     | From Discord                  | Redirects to the website                 |
| `GET /auth/me`                   |                               | The logged-in user, or `401`             |
| `POST /auth/refresh`             |                               | `204` with new session cookies, or `401` |
| `POST /auth/logout`              |                               | `204`                                    |

Content reads return only public content: visible, in a visible collection
(hidden ones are `404`), and for news, dated now or earlier (a later date is
scheduled). `tags=a,b` keeps images with every tag, written lowercase, unique,
and sorted (`400` otherwise, so one filter has one cache entry).

Content reads (`/news` to `/maps/seasons`) also take `v`, the current `version`:
only responses for it are cached (a day at Cloudflare's edge), and an edit
changes it, so it shows on the next page load. `/news` and `/news/count` also
need `dv`, the news detail version, so scheduled posts show on their date.
Without `v`, they're never cached
([Content versions](./.claude/docs/api.md#content-versions)).

### Editor

Every other request, including any unknown path, needs a logged-in editor and
answers `401` otherwise: public routes are an allow list in
[`src/api/public-routes.ts`](./src/api/public-routes.ts). Any request other than
GET, HEAD, or OPTIONS must send `Origin: <FRONTEND_URL>` (CSRF protection), or
gets `403`. Request bodies must be JSON (`415` otherwise).

| Endpoint                                                                                        | Query                                                                                  | Returns                                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET /editor/news`, `/editor/gallery/images`, `/editor/downloads/items`, `/editor/maps/seasons` | `startIndex`, `limit`, `createdBy`, `lastUpdatedBy`, `status`, `collection`, `q`, `in` | `{ items, total }`: every item's summary, status, and history |
| `GET /editor/<…>/:id`                                                                           |                                                                                        | One whole item, public or not                                 |
| `GET /editor/gallery/collections`, `/editor/downloads/collections`                              |                                                                                        | Every collection, with its item count                         |

Errors are `{ "error": string }`. Response types:
[`src/contract/api-responses.ts`](./src/contract/api-responses.ts), which the
website copies (see its README's "API contract"). How routes, errors, and
sessions work: [api.md](./.claude/docs/api.md).

## Sessions and access

Logins use a short-lived JWT (`session`) plus a periodically rotating refresh
token (`refresh_token`), used for generating JWTs, stored in Redis
([`src/auth/`](./src/auth/)). Lifetimes are in
[`src/config/auth.ts`](./src/config/auth.ts). Three rate limiters, tuned in
[`src/config/rate-limits.ts`](./src/config/rate-limits.ts): the **auth limiter**
(per client IP, on logging in, refresh, and logout), the **write limiter** (per
editor, or IP when logged out, on every write), and the **read limiter** (the
same, on every read; higher without the tunnel, see
[Behind Cloudflare](#behind-cloudflare)); see
[api.md](./.claude/docs/api.md#rate-limits).

- **Generate `JWT_SECRET`:**
  `node -e "console.log(require('node:crypto').randomBytes(64).toString('base64url'))"`
- **Same site:** the API and website must share a site (e.g. `api.example.com`
  and `example.com`), or browsers won't send the cookies.
- **Register** `DISCORD_REDIRECT_URI` under OAuth2 → Redirects in the Discord
  application.
- **Log everyone out:** rotate `JWT_SECRET`, which invalidates every access and
  refresh token at once; also delete the `session:*` keys in Redis to clear the
  sessions it leaves behind.

**Who can log in:** documents in the `auth` database's `accessGrants`
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

## Behind Cloudflare

In production the API sits behind a Cloudflare Tunnel on the website's zone
(e.g. `api.example.com`), so Cloudflare names each client and other zones'
Workers can be blocked. Rate limits then key clients by `CF-Connecting-IP`; for
the website's server rendering that's the visitor, not the Worker. Without the
tunnel (e.g. in development), every visitor's rendered pages share one IP, so
reads get `READ_RATE_LIMIT_WITHOUT_TUNNEL` instead, and one person could still
use it up for everyone.

1. Run `cloudflared` next to the API and route `api.<domain>` to it.
2. **Remove the service's public port** (Northflank: private ports only).
   `BEHIND_CLOUDFLARE_TUNNEL=true` trusts a header anyone could send, so the
   server must not be reachable except through the tunnel.
3. Set `BEHIND_CLOUDFLARE_TUNNEL=true` (and leave `TRUST_PROXY_HOPS` at `0`).
4. Add a WAF custom rule on the zone that blocks other zones' Workers:
   `not (cf.worker.upstream_zone in {"" "<domain>"})` → Block.
5. Point the website's `API_URL` and `DISCORD_REDIRECT_URI` at `api.<domain>`.
6. Add a Cache Rule for `api.<domain>`: Eligible for cache, Edge TTL "Use
   cache-control header if present, bypass cache if not". Cloudflare doesn't
   cache JSON by default, and the API sends `no-store` on everything that
   mustn't be shared ([Caching](./.claude/docs/api.md#caching)). Check that a
   second `GET /news?v=<version>` answers `cf-cache-status: HIT`. Keep the query
   string in the cache key (the default), or every content version shares one
   entry.

## Data

**MongoDB:** databases `news` (collection `posts`), `gallery` (`images`, plus
`collections`: each gallery's `slug` and `title`), `downloads` (`items`, plus
`collections`), `maps` (`seasons`), `auth` (`accessGrants`), and `content`
(`meta`: the content version). Add content directly, then set the
`contentVersion` document's `version` to any new whole number (e.g. the current
time in ms) so the edit shows at once. See
[database.md](./.claude/rules/database.md).

**Redis:** one hash per login session, key `session:<session ID>`, expiring with
the session; fields in
[`src/auth/refresh-tokens.ts`](./src/auth/refresh-tokens.ts).

## Project structure

```text
src/
├── auth/         Discord login, tokens, cookies
├── config/       Environment variables and tunable settings
├── contract/     Response types shared with the website
├── errors/       Errors mapped to status codes
├── helpers/      Editor logic
├── managers/     MongoDB, Redis, and Discord access
├── middleware/   CORS, sessions, error handler
├── models/       Mongoose schemas
├── routes/       Routers, one folder per URL group
├── app.ts        Builds the Express app
└── index.ts      Entry point
test/             Test helpers
```

## Troubleshooting

| Problem                      | Check                                                 |
| ---------------------------- | ----------------------------------------------------- |
| Exits on startup             | The listed `.env` variables; MongoDB and Redis are up |
| `404` for a gallery/download | Its slug is in the database's `collections`           |
| `500` errors                 | The server console                                    |
| `403` on a POST              | `Origin` is exactly `FRONTEND_URL`                    |
| Login fails                  | The `error` code on `/admin/login` and the console    |
