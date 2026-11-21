# API

The endpoints themselves are listed in the README. This covers how routes work
and the rules for changing them. To add one, use the `add-endpoint` skill.

## Routes

`createApp(config)` in `src/app.ts` wires the app together: the app-wide
middleware from `src/middleware/` (CORS allowing only `FRONTEND_URL`, with
credentials, so the website's cookies are sent; the same headers whatever the
`Origin`, since Cloudflare's cache ignores `Vary`; the session; the login gate,
see [Access](#access); the rate limits; the error handler), and one router per
URL prefix from `src/routes/` (`apiRouters`). Router- or route-specific
middleware, like a public read's `cacheByContentVersion`, stays in its router.
It doesn't connect or listen, so tests can drive it directly.

A route:

1. parses `req.params`, `req.query`, and cookies with the schemas in
   `src/api/query-schemas.ts` (never passes raw values on),
2. for a `:collection` route, verifies inputs and throws `NotFoundError` if it's
   missing (an unknown collection would otherwise return an empty list),
3. calls `mongo-manager`, using `Promise.all` for independent queries,
4. sends the body through `parseResponse` and a schema from
   `src/api/response-schemas.ts`.

Routes don't catch errors: Express 5 forwards thrown errors and rejected
promises to the handler.

## Errors

The handler in `src/middleware/error-handler.ts` answers `{ "error": string }`:

| Error                                    | Status | Body                                                       |
| ---------------------------------------- | ------ | ---------------------------------------------------------- |
| `ZodError` (bad params, query, or body)  | `400`  | Which fields are wrong, and why                            |
| `BadRequestError` (`src/errors/`)        | `400`  | Invalid given stored data (a date)                         |
| Malformed JSON body (body-parser)        | `400`  | Generic; never echoes the body                             |
| `UnauthorizedError` (`src/errors/`)      | `401`  | Nobody is logged in, or bad refresh                        |
| `ForbiddenError` (`src/errors/`)         | `403`  | A write not from the website (CSRF)                        |
| `NotFoundError` (`src/errors/`)          | `404`  | What wasn't found; also no route                           |
| `ConflictError` (`src/errors/`)          | `409`  | Stale revision (with `current`), or a taken slug or season |
| Body over `JSON_BODY_LIMIT`              | `413`  | Generic                                                    |
| `UnsupportedMediaTypeError`, bad charset | `415`  | The body must be JSON (UTF-8)                              |
| Rate limit (see [below](#rate-limits))   | `429`  | Try again later (callback: redirect)                       |
| Anything else, incl. a broken contract   | `500`  | Generic message; details only logged                       |

Never reveal internals (stack traces, queries, connection strings) in a body.
Every error is sent `Cache-Control: no-store`, even from a cacheable route
([Caching](#caching)).

## Access

Every request passes, in order (`createApp`): the `no-store` default → CORS →
the CSRF origin check (`403`) → the session → the write limiter, the read
limiter, and the auth limiter for `/auth/*` but `/auth/me` (`429`) → the login
gate (`401`) → the JSON body check (`400`, `413`, `415`) → the routers (or
`404`).

Anyone may read public content; everything else needs a logged-in editor (anyone
who can log in is an editor, see the README's "Sessions and access"). It's
default deny: `requireLogin` (`src/middleware/require-login.ts`) runs before
every router and answers `401` unless the request matches `PUBLIC_ROUTES`
(`src/api/public-routes.ts`). So a new route is private until it's added to that
list, and logged-out callers get `401` for unknown paths too (they can't map the
private routes). Every response is `Cache-Control: no-store` but public reads,
which stay cacheable even for a logged-in editor (see [Caching](#caching)).

To make a route public, add it to `PUBLIC_ROUTES`; the gate's tests
(`src/middleware/require-login.test.ts`) cover every entry, check each is a
defined route, and fail if a public pattern also matches a private route (e.g.
`/gallery/:collection` would match `/gallery/drafts`). Express matches whole
paths, so `/news` never makes `/news/drafts` public. A private route needs a
test that it answers `401` when logged out (`test/session.ts` makes the cookie
for logged-in tests).

### CSRF

`requireFrontendOrigin` (`src/middleware/require-frontend-origin.ts`) runs first
and answers `403` to any request other than GET, HEAD, or OPTIONS whose `Origin`
isn't exactly `FRONTEND_URL`, public or not (so it also covers `/auth/refresh`
and `/auth/logout`). `SameSite=Lax` cookies already stay off cross-site
requests, but not off a sibling subdomain's. A missing `Origin` is refused too:
only the website's browser code writes (server rendering only reads), so
non-browser callers (curl) must send `Origin` themselves. Never change state in
a GET route; it isn't checked.

### Request bodies

After the login gate, `jsonBody` (`src/middleware/json-body.ts`) parses JSON
bodies up to `JSON_BODY_LIMIT` (`src/config/requests.ts`). It reads any other
body, up to the same limit, only to check it's empty: an empty one passes (a
browser's empty POST has no `Content-Type`, a chunked one no length), anything
else gets `415`. That also keeps out the form, text, and untyped bodies a page
can send cross-site without a preflight. So routes only ever see parsed JSON (or
nothing) in `req.body`, and logged-out bodies are never read. Still validate
`req.body` with a Zod schema before use.

CORS allows `GET,POST,PATCH,DELETE,OPTIONS` (`src/middleware/cors.ts`): a route
with any other method must add it there, or browsers block it.

### Rate limits

Three limiters in `src/middleware/rate-limits.ts`, tuned in
`src/config/rate-limits.ts`, so every request that passes the CSRF check is
limited somewhere. Requests that check refuses aren't counted: a `403` is cheap,
and counting it would let a page on a sibling subdomain, which can send an
editor's cookies, use up that editor's write budget. Each keeps its own counts,
so none uses up another's budget, though a request may count in two (a login's
`/auth/discord` and callback count as reads too). Counts are per app instance,
in memory. Each answers `429`, except that a rate-limited Discord callback
redirects to the login page (`rate-limited`), whichever limiter stopped it.

|                | Auth limiter                                     | Write limiter                                              | Read limiter                                                                         |
| -------------- | ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Guards against | Login abuse, refresh-token guessing              | Anyone flooding writes (incl. a stolen session)            | Scraping, flooding reads                                                             |
| Counts         | `/auth/*` but `/auth/me`: login, refresh, logout | Every request other than GET, HEAD, OPTIONS, but `/auth/*` | Every GET and HEAD                                                                   |
| Keyed by       | Client IP (see below; IPv6 /56)                  | Logged-in user's ID (editors may share an IP), or IP       | Same as the write limiter                                                            |
| Mounted        | On `/auth`, after the read limiter               | Before `requireLogin`, app-wide                            | After the write limiter, app-wide                                                    |
| Settings       | `AUTH_RATE_LIMIT`, `AUTH_RATE_LIMIT_WINDOW_MS`   | `WRITE_RATE_LIMIT`, `WRITE_RATE_LIMIT_WINDOW_MS`           | `READ_RATE_LIMIT`, `READ_RATE_LIMIT_WINDOW_MS`; env `READ_RATE_LIMIT_WITHOUT_TUNNEL` |

The auth limiter guards the login steps and session upkeep, so it's the
strictest. `/auth/me` is only a read (the admin pages call it on every
navigation), and refresh and logout aren't writes, so an editor's writes can
never stop them keeping or ending their session.

The auth limiter is keyed by IP because its callers usually aren't logged in.
The client IP (`clientIp`) is `CF-Connecting-IP` when `BEHIND_CLOUDFLARE_TUNNEL`
is set (the README's "Behind Cloudflare"), else `req.ip`, where a wrong
`TRUST_PROXY_HOPS` either puts every client behind one budget (too low) or lets
a client forge `X-Forwarded-For` (too high). The read and write limiters run
before the login gate, as does the auth limiter, so they count logged-out
requests too: probing private or unknown paths uses up the visitor's own budgets
(the auth one too, under `/auth`), then gets `401`.

Behind the tunnel, Cloudflare names the visitor even for the Worker's requests,
so each visitor has their own read budget (`READ_RATE_LIMIT`). Without it, the
website's server rendering reaches the API from Cloudflare's shared IPs (or
localhost in development), so every read gets the higher
`READ_RATE_LIMIT_WITHOUT_TUNNEL` (default in `src/config/rate-limits.ts`).
That's still one budget for every visitor's rendered pages: one person
requesting pages fast enough could get `429`s for everyone, so production should
run behind the tunnel.

### Caching

Each public read but `/health`, `/content/version`, and `/auth/*` mounts
`cacheByContentVersion` (`src/middleware/cache-control.ts`), which caches it
only under the current content version (below), for `VERSIONED_CACHE`
(`src/config/caching.ts`): `Cache-Control: public, max-age=…` for browsers, and
a longer `CDN-Cache-Control` for Cloudflare, which reads it first. Mount it on
the route, never with `router.use`, or private routes under the same prefix
would be cached too. Everything else is `no-store`: `noCachingByDefault` runs
first in `createApp`, so private, `/auth`, `/health`, preflight, and `429`
responses are never cached, and `handleError` calls `forbidCaching` (which also
drops `CDN-Cache-Control`), so neither is a `404` or `500` from a public read.
`cacheByContentVersion` also drops the rate limiters' `RateLimit` headers, which
describe one caller's budget. `src/middleware/cache-control.test.ts` fails if a
public read doesn't mount it, and checks every one handles `v` (below).

The editor's reads (`/editor/*` but drafts) mount `revalidateEveryTime` instead:
`Cache-Control: private, no-cache`, so a browser keeps a copy but revalidates it
by the ETag Express sets every time (`304` when unchanged), and nothing shared
keeps it.

#### Content versions

So an edit shows on the next page load without purging Cloudflare, public reads
are versioned: one site-wide content version (`GET /content/version`, never
cached), which callers send as `?v=` on every public read.
`cacheByContentVersion` handles `v` for every route that mounts it, so no route
can forget it:

| `v`                          | Response                                                          |
| ---------------------------- | ----------------------------------------------------------------- |
| The current version          | `VERSIONED_CACHE`: a day at the edge                              |
| Any other number, or missing | Current content, `no-store` (made-up values can't fill the cache) |
| Not digits                   | `400`                                                             |

`v` is compared as the digits sent, so `0…` variants don't match. The version is
read before the content, so a response is never older than the version it's
cached under. Writes call `updateContentVersion` (`mongo-manager`) once they've
committed (never before, or a read in between caches old content under the new
version), which sets the current time, or one more than the current version if
that's not later, so it always changes. A missing version is created on the
first read.

##### Detail versions

A scheduled news post goes live on its date without a write, so `v` alone would
keep it hidden for up to a day. Areas registered in
`src/config/detail-versions.ts` (only `news`) also have a detail version,
`GET /content/version/:area` (never cached, `404` for an unknown area), which
callers send as `?dv=` with `v` on that area's routes. `cacheByContentVersion`
caches them only when both are current; otherwise they're current content with
`no-store`, and a `dv` that isn't digits is `400` (other routes ignore `dv`).
News's is the date (ms) of the newest public post (`0` with none), computed on
every read, so it changes when a post goes live. Only the date: every other
change (an edit, hide, delete, or move) is a write, so `v` changes anyway, and
`dv` may then return to an earlier value safely. A new area is one entry: its
routes and how to compute its key.

A cached response is shared by every caller, so it mustn't depend on who asks:
no `Set-Cookie`, nothing from the session, and CORS headers that don't vary by
`Origin` (`src/middleware/cors.ts`; Cloudflare ignores `Vary`). Cloudflare
caches only what its Cache Rule allows, and the rule defers to these headers
(the README's "Behind Cloudflare"). After editing content directly in MongoDB,
change the version by hand too (the README's "Data"); otherwise the edit shows
once the edge and browser copies expire, or after purging Cloudflare's cache.

## Sessions

`sessionMiddleware` (`src/middleware/session.ts`) runs before every route. It
verifies the access token in the `session` cookie and sets `res.locals.user`; it
never rejects a request, and never re-issues a token: an expired one means
nobody is logged in until the website calls `POST /auth/refresh`. It never sets
or clears a cookie, so it can't clash with the refresh's. Rejecting is
`requireLogin`'s job ([Access](#access)). Set and clear the cookies only through
`src/auth/session-cookie.ts`, so their options always match.

Refresh tokens (`src/auth/refresh-tokens.ts`) are `<session ID>.<secret>.<tag>`,
single-use, and rotated on every refresh. The tag is an HMAC of the rest keyed
by `JWT_SECRET` (so rotating it ends every session), checked before Redis is
touched, so a session ID alone can't end a session through refresh or logout.
Logs name the Discord user, never a session ID or token. Each login is a
session: one Redis hash holding the current secret's hash. It expires
`SESSION_IDLE_TIMEOUT_MS` after the login or its last refresh, but never past
`SESSION_MAX_AGE_MS` after the login (`sessionEndsAt`, `src/auth/session.ts`;
settings in `src/config/auth.ts`). A user may have many. Presenting an
already-used token ends its whole session (reuse detection), except the previous
token within a short grace window, which gets the same new token again (so the
next secret is an HMAC of the previous one, not random). Rotation, grace, and
reuse are one atomic Redis script; a refresh then pushes the expiry later with
`PEXPIREAT … GT` (Redis 7+), which never shortens it if a slower concurrent
refresh lands last and does nothing to a session already ended. If it fails, the
refresh still succeeds (the rotation has committed) and the error is logged.
Every Redis command goes through `src/managers/redis-manager.ts`, as every
MongoDB query goes through `mongo-manager`.

The Discord login lives in `src/auth/discord-login.ts`, and every call to
Discord in `src/managers/discord.ts`, which throws `DiscordApiError` for any
Discord failure. The callback never answers with an error status; it redirects
to the website with a `LoginErrorCode`, so a failure is always attributed to the
user, this server, or Discord.

## Editor writes

Every editor write body (creates, updates, bulk items, draft publishes) goes
through `src/api/write-schemas.ts`. Each content type has one object of its
fields' types and caps (`src/config/content-limits.ts`), in three variants:
`full` for a whole item, `patch` for an update's fields, and `draft` (types and
caps only, every field optional). `full` and `patch` also check every image URL
against `IMAGE_URL_PREFIXES` (`src/config/images.ts`) and news markdown with
`marked` (`src/api/markdown.ts`): no raw HTML, only allowlisted images, and only
web, email, or relative links; titles inline only. `marked` is pinned to the
website's version, so the server checks the tokens the website renders. News
dates and `editedAt` follow `src/helpers/news-dates.ts` once the stored post is
read.

Creates send a client UUID (`createId`, unique and sparse on every model): a
repeat returns the item already made (`200`, not `201`), without checking the
body again, and still changes the content version. Updates (`PATCH`, body
`revision`) and deletes (`?revision=`) send the revision they started from; a
stale one is `409` with the item as it is now. Every committed write calls
`updateContentVersion`.

## Response contract

`src/contract/api-responses.ts` holds the response types. The website keeps a
verbatim copy, so keep the file dependency-free.

Each schema in `response-schemas.ts` is typed with `z.toZod<ContractType>()`, so
it fails to compile if it drifts from the contract. `parseResponse` drops fields
outside the contract (e.g. `_id`), turns Dates into ISO strings, and throws a
`500` if stored data is missing a required field: bad stored data is a server
fault, not the caller's.

To change a response:

1. Edit the contract file.
2. Update the schemas until they compile.
3. Run `npm run api:sync` in `../website` and update its services.

## Design rules

- **REST.** Nouns for resources (`/gallery/:collection`, not
  `/gallery/get-items`), HTTP methods for actions, query parameters for
  filtering and pagination, JSON for every body, including errors.
- **Status codes match the outcome:** `2xx` only on success, `4xx` for client
  mistakes, `5xx` for server failures.
- **Error messages** help the caller fix their request without helping an
  attacker probe: a failed sign-in says "invalid email or password", not which
  one was wrong.
- **Editor lists send summaries.** A list (an editor table) sends only what it
  shows, leaving out long fields (news content, a download's description, map
  dimensions, which become a `dimensionCount`, a draft's fields); opening an
  item fetches all of it (`/:id`).
- **Pagination.** Collections that can grow take `startIndex`/`limit`
  (`paginationQuery`) and return `{ items, total }`, plus a `/count` endpoint.
- **Compatibility.** Keep responses backward compatible. Check
  `../website/src/app/services/` before changing a path, parameter, status code,
  or field; raise breaking changes with the user and update the website in step.
