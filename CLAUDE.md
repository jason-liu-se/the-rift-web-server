# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Overview

Read-only REST API (TypeScript, Express, Mongoose, Zod) serving news, gallery,
and download content from MongoDB to The Rift website
([`../website`](../website), Angular). Node/npm requirements are in `README.md`;
library versions in `package.json`.

## Commands

```bash
npm ci                                 # install
npm run dev                            # run src/index.ts directly, restart on change
npm run build                          # compile src/ to dist/
npm start                              # run the build (dist/index.js)
npm run typecheck                      # tsc over src, test, and configs
npm test                               # Vitest (needs no .env or database)
npm test -- <path/to/file.test.ts>     # single test file
npm run lint / lint:fix                # ESLint (typescript-eslint)
npm run format / format:check          # Prettier
```

`dev` and `start` load `.env` if it exists. A Husky pre-commit hook lints and
formats staged files. Run `typecheck`, `lint`, and `test` before calling work
done.

## Conventions

- Formatting and lint rules live in `.prettierrc`, `.editorconfig`, and
  `eslint.config.js`; compiler options in `tsconfig.json`.
- ES modules. Local imports include the `.ts` extension
  (`import { app } from "./app.ts"`); the build rewrites them. Only erasable
  TypeScript syntax: no `enum`, `namespace`, or constructor parameter
  properties.
- Named exports only. Strict TS with `noPropertyAccessFromIndexSignature` and
  `noUncheckedIndexedAccess`.
- Read configuration through `loadEnv()` (`src/config/env.ts`), never
  `process.env` directly. A new variable goes in that schema and the README's
  environment table.

## Architecture

- **`src/app.ts` builds the app; `src/index.ts` runs it.** `app.ts` sets CORS
  headers, mounts one router per URL prefix, and installs the error handler,
  without connecting or listening, so tests can drive it with Supertest.
  `index.ts` validates the environment, connects to MongoDB, listens, and shuts
  down gracefully on SIGTERM/SIGINT.
- **Routers** (`src/routes/`) parse `req.query` with the Zod schemas in
  `src/routes/query-schemas.ts`, call `mongo-manager`, and send the result. They
  don't catch errors: Express 5 forwards thrown errors and rejected promises to
  the handler in `app.ts`, which answers `400` for a `ZodError` and a generic
  `500` (details logged, not returned) for anything else.
- **`src/helpers/mongo-manager.ts` owns all database access.** Routers never
  touch models. Each content type has its own database, with one schema and
  interface per file in `src/models/`. Collection names are used as given
  (pluralization and auto-creation are off), so an unknown collection returns an
  empty list, not an error.
- **The website is the only client.** It reads these responses through the
  interfaces in `../website/src/app/interfaces/` and the services in
  `../website/src/app/services/`. Endpoint paths, query parameters, and response
  shapes are a contract: check the website before changing them.

## Testing

Vitest + Supertest against `app` from `src/app.ts`, with a throwaway in-memory
MongoDB from `test/database.ts` (`startDatabase`, `stopDatabase`,
`clearDatabase`, and `collection` for seeding raw documents). Test files sit
next to the code as `*.test.ts`. The first run downloads a MongoDB binary.

## Engineering standards

Work as a software engineer, not a code generator.

- **Version-specific best practices.** Follow the official docs and current
  recommended patterns for each technology at the exact versions in
  `package.json` (Node, Express, Mongoose, Zod, TypeScript), not generic habits
  or patterns that version has deprecated or replaced (e.g. Express 4 error
  handling, Mongoose callbacks, Zod 3 APIs). If existing code uses an outdated
  pattern, use the modern one in new code and raise a wider migration with the
  user.
- **Reuse (DRY).** Check `mongo-manager`, `query-schemas`, and existing models
  before writing new logic; extract duplication into a shared function or schema
  that variants compose.
- **Design.** Encapsulation, composition, single responsibility; low coupling,
  high cohesion. Prefer pure functions; keep side effects (database, network,
  process, logging) at the edges.
- **Clarity.** Descriptive names, small functions, guard clauses, and named
  constants instead of magic values. Choose the simple solution over a clever
  one; if a non-obvious version is worth keeping, comment what it does and why.
- **Write less code.** Humans review every line. Use what Express, Mongoose, and
  Zod provide, and skip speculative code (unused options, "just in case"
  branches, single-caller abstractions).
- **Dependencies.** Add a package only for substantial functionality likely to
  be reused soon, or that is costly or error-prone to build (e.g. security,
  date/time, parsing), and justify it to the user.
- **Validate at the boundary.** Every request input and environment variable
  goes through a Zod schema before use. Never pass raw `req.query`/`req.body`
  values into a Mongo query or filter (NoSQL injection), and validate
  user-supplied collection names.
- **Errors.** Throw and let the error handler respond with the status code that
  matches the outcome: `2xx` only when the request succeeded, `4xx` for client
  mistakes, `5xx` for server failures. Log the full error on the server, but
  tell the caller only what they need to fix their request. Never reveal
  internals (stack traces, queries, connection strings) or anything that helps
  an attacker probe the system: e.g. a failed sign-in says "invalid email or
  password", not which one was wrong or whether the account exists.
- **RESTful design.** Model URLs as resources with nouns, not verbs
  (`GET /news`, `GET /gallery/:collection`, not `/news/get-items`); use HTTP
  methods for actions, query parameters for filtering and pagination, and status
  codes that match the outcome (`200`, `201`, `204`, `400`, `404`, `500`, ...).
  Return JSON consistently, including errors (`{ "error": string }`). Current
  endpoints predate this: follow it for new endpoints, and treat migrating the
  existing ones as a breaking change (see below).
- **API compatibility.** Keep responses backward compatible with the website.
  For a breaking change (renamed field, new required parameter, different status
  code), raise it with the user and update the website in step.
- **Queries.** Keep reads bounded and paginated where a collection can grow, let
  MongoDB do filtering and sorting, and avoid one query per item when a single
  query or `Promise.all` will do.
- **Tests.** Test real behaviour (status codes, response bodies, database
  effects) so tests fail when it breaks; never write tests just to pass.
- **Scope and debt.** Keep changes scoped. Fix minor debt and remove dead code
  in code you touch; raise major debt or unrelated refactors with the user.
- **Docs.** Update `README.md` (and `CLAUDE.md` where relevant) in the same
  change whenever setup, commands, requirements, structure, endpoints, or
  behaviour it describes changes. Point to where things live in code instead of
  copying values (versions, ports, timeouts, limits), so docs don't drift from
  the code. Don't list Claude tooling (hooks, skills, agents, MCP servers) in
  `CLAUDE.md`; Claude discovers these on its own.
