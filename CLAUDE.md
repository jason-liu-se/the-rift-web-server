# CLAUDE.md

Read-only REST API (TypeScript, Express, Mongoose, Zod) serving news, gallery,
and download content from MongoDB to The Rift website
([`../website`](../website), Angular, its only client). Setup, endpoints, and
environment variables are in `README.md`; library versions in `package.json`.

## Commands

```bash
npm run dev                            # run src/index.ts, restart on change
npm run build / start                  # compile to dist/ / run the build
npm run docker:build / docker:start    # build the image / run it with .env
npm run typecheck                      # tsc over src, test, and configs
npm test                               # Vitest (needs no .env or database)
npm test -- <path/to/file.test.ts>     # one test file
npm run lint / format                  # ESLint / Prettier (lint:fix, format:check)
```

Run `typecheck`, `lint`, and `test` before calling work done. A Husky pre-commit
hook lints and formats staged files.

## Docs

Read the relevant file before working in its area:

- `.claude/docs/api.md`: routes, error handling, the response contract with the
  website, and REST/compatibility rules.
- `.claude/docs/database.md`: `mongo-manager`, models, collections, and query
  rules.
- `.claude/docs/testing.md`: test setup and helpers.

## Architecture

- **`src/app.ts` builds the app; `src/index.ts` runs it** (validates the
  environment, connects to MongoDB, listens, shuts down gracefully).
- **Routers** (`src/routes/`) validate input with Zod, call `mongo-manager`, and
  send bodies through the response schemas. They don't catch errors; the handler
  in `app.ts` maps them to status codes.
- **`src/helpers/mongo-manager.ts` owns all database access.** Routers never
  touch models.
- **`src/contract/api-responses.ts` is the contract with the website**, which
  keeps a verbatim copy. Endpoint paths, parameters, and response shapes must be
  changed conservatively since the frontend must be updated to maintain
  synchronicity.

## Conventions

- ES modules. Local imports include the `.ts` extension; the build rewrites
  them. Only erasable TypeScript: no `enum`, `namespace`, or constructor
  parameter properties.
- Named exports only. Strict TS with `noPropertyAccessFromIndexSignature` and
  `noUncheckedIndexedAccess`.
- Read configuration through `loadEnv()` (`src/config/env.ts`), never
  `process.env`.

## Engineering standards

- **Version-specific best practices.** Follow the official docs and current
  patterns for the exact versions in `package.json`, not deprecated ones (e.g.
  Express 4 error handling, Mongoose callbacks, Zod 3 APIs). Where existing code
  is outdated, use the modern pattern in new code and raise a wider migration
  with the user.
- **Reuse and design.** Check `mongo-manager`, `query-schemas`, and the models
  before writing new logic; extract duplication into a shared function or schema
  that variants compose. Single responsibility, low coupling, pure functions,
  side effects (database, network, logging) at the edges.
- **Clarity.** Descriptive names, small functions, guard clauses, named
  constants. Simple over clever; comment a non-obvious version that's worth
  keeping.
- **Write less code.** Humans review every line. Use what Express, Mongoose, and
  Zod provide, and skip speculative code (unused options, "just in case"
  branches, single-caller abstractions).
- **Validate at the boundary.** Every request input and environment variable
  goes through a Zod schema before use. Never pass raw `req.query`/`req.body`
  into a Mongo query (NoSQL injection).
- **Errors.** Throw and let the error handler pick the status. Log details on
  the server; tell the caller only what they need to fix their request, never
  internals or anything that helps an attacker probe the system.
- **Dependencies.** Add a package only for substantial, likely-reused, or
  error-prone functionality (e.g. security, date/time, parsing), and justify it
  to the user.
- **Tests.** Test real behaviour (status codes, bodies, database effects) so
  tests fail when it breaks.
- **Scope and debt.** Keep changes scoped. Fix minor debt and remove dead code
  in code you touch; raise major debt or unrelated refactors with the user.
- **Docs.** Update `README.md`, `.claude/docs/`, skills, and `CLAUDE.md` in the
  same change when what they describe changes. Point to code instead of copying
  values (versions, ports, limits), and don't list Claude tooling here.
