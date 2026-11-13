# API

The endpoints themselves are listed in the README. This covers how routes work
and the rules for changing them. To add one, use the `add-endpoint` skill.

## Routes

`createApp(config)` in `src/app.ts` sets the CORS headers (only for
`FRONTEND_URL`, with credentials, so the website's cookies are sent), mounts one
router per URL prefix from `src/routes/`, and installs the error handler. It
doesn't connect or listen, so tests can drive it directly.

A route:

1. parses `req.params` and `req.query` with the schemas in
   `src/routes/query-schemas.ts` (never passes raw values on),
2. for a `:collection` route, verifies inputs and throws `NotFoundError` if it's
   missing (an unknown collection would otherwise return an empty list),
3. calls `mongo-manager`, using `Promise.all` for independent queries,
4. sends the body through `parseResponse` and a schema from
   `src/routes/response-schemas.ts`.

Routes don't catch errors: Express 5 forwards thrown errors and rejected
promises to the handler.

## Errors

The handler in `src/app.ts` answers `{ "error": string }`:

| Error                                  | Status | Body                                 |
| -------------------------------------- | ------ | ------------------------------------ |
| `ZodError` (bad params or query)       | `400`  | Which parameters are wrong           |
| `UnauthorizedError` (`src/errors/`)    | `401`  | Nobody is logged in                  |
| `NotFoundError` (`src/errors/`)        | `404`  | What wasn't found; also no route     |
| Anything else, incl. a broken contract | `500`  | Generic message; details only logged |

Never reveal internals (stack traces, queries, connection strings) in a body.

## Sessions

`sessionMiddleware` (`src/auth/`) runs before every route. It reads the session
cookie, re-issues an expired token while the session lasts, and sets
`res.locals.user`; it never rejects a request. A route that needs a user throws
`UnauthorizedError` when `res.locals.user` is unset. Set and clear the cookie
only through `src/auth/session-cookie.ts`, so its options always match.

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
