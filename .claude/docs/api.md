# API

The endpoints themselves are listed in the README. This covers how routes work
and the rules for changing them. To add one, use the `add-endpoint` skill.

## Routes

`createApp(config)` in `src/app.ts` wires the app together: the app-wide
middleware from `src/middleware/` (CORS allowing only `FRONTEND_URL`, with
credentials, so the website's cookies are sent; the same headers whatever the
`Origin`, since Cloudflare's cache ignores `Vary`; the session; the login gate,
see [Access](#access); the rate limits; the error handler), and one router per
URL prefix from `src/routes/` (`apiRouters`). Router-specific middleware, like
the `/auth` routes' `no-store`, stays in its router. It doesn't connect or
listen, so tests can drive it directly.

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

| Error                                    | Status | Body                                 |
| ---------------------------------------- | ------ | ------------------------------------ |
| `ZodError` (bad params or query)         | `400`  | Which parameters are wrong           |
| Malformed JSON body (body-parser)        | `400`  | Generic; never echoes the body       |
| `UnauthorizedError` (`src/errors/`)      | `401`  | Nobody is logged in, or bad refresh  |
| `ForbiddenError` (`src/errors/`)         | `403`  | A write not from the website (CSRF)  |
| `NotFoundError` (`src/errors/`)          | `404`  | What wasn't found; also no route     |
| Body over `JSON_BODY_LIMIT`              | `413`  | Generic                              |
| `UnsupportedMediaTypeError`, bad charset | `415`  | The body must be JSON (UTF-8)        |
| Rate limit (see [below](#rate-limits))   | `429`  | Try again later (callback: redirect) |
| Anything else, incl. a broken contract   | `500`  | Generic message; details only logged |

Never reveal internals (stack traces, queries, connection strings) in a body.

## Access

Every request passes, in order (`createApp`): CORS → the CSRF origin check
(`403`) → the session → the write limiter, the read limiter, and the auth
limiter for `/auth/*` but `/auth/me` (`429`) → the login gate (`401`) → the JSON
body check (`400`, `413`, `415`) → the routers (or `404`).

Anyone may read public content; everything else needs a logged-in editor (anyone
who can log in is an editor, see the README's "Sessions and access"). It's
default deny: `requireLogin` (`src/middleware/require-login.ts`) runs before
every router and answers `401` unless the request matches `PUBLIC_ROUTES`
(`src/api/public-routes.ts`). So a new route is private until it's added to that
list, and logged-out callers get `401` for unknown paths too (they can't map the
private routes). Private and `/auth` responses get `Cache-Control: no-store`;
public reads stay cacheable even for a logged-in editor.

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

CORS allows only `GET,POST,OPTIONS` (`src/middleware/cors.ts`): the first PUT,
PATCH, or DELETE route must add its method there, or browsers block it.

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

## Sessions

`sessionMiddleware` (`src/middleware/session.ts`) runs before every route. It
verifies the access token in the `session` cookie and sets `res.locals.user`; it
never rejects a request, and never re-issues a token: an expired one means
nobody is logged in until the website calls `POST /auth/refresh`. It never sets
or clears a cookie, so it can't clash with the refresh's. Rejecting is
`requireLogin`'s job ([Access](#access)). Set and clear the cookies only through
`src/auth/session-cookie.ts`, so their options always match.

Refresh tokens (`src/auth/refresh-tokens.ts`) are `<session ID>.<secret>`,
single-use, and rotated on every refresh. Each login is a session: one Redis
hash holding the current secret's hash, until `SESSION_MAX_AGE_MS`
(`src/config/auth.ts`) after the login. A user may have many. Presenting an
already-used token ends its whole session (reuse detection), except the previous
token within a short grace window, which gets the same new token again (so the
next secret is an HMAC of the previous one, not random). Rotation, grace, and
reuse are one atomic Redis script. Every Redis command goes through
`src/helpers/redis-manager.ts`, as every MongoDB query goes through
`mongo-manager`.

The Discord login lives in `src/auth/discord-login.ts`, and every call to
Discord in `src/helpers/discord.ts`, which throws `DiscordApiError` for any
Discord failure. The callback never answers with an error status; it redirects
to the website with a `LoginErrorCode`, so a failure is always attributed to the
user, this server, or Discord.

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
- **Pagination.** Collections that can grow take `startIndex`/`limit`
  (`paginationQuery`) and return `{ items, total }`, plus a `/count` endpoint.
- **Compatibility.** Keep responses backward compatible. Check
  `../website/src/app/services/` before changing a path, parameter, status code,
  or field; raise breaking changes with the user and update the website in step.
