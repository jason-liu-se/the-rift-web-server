---
paths:
    - "**/*.test.ts"
    - "test/**/*"
    - "vitest.config.ts"
---

# Testing

Vitest + Supertest integration tests: requests go to `app` from `test/app.ts`
(`createApp` from `src/app.ts` with the fixed `testConfig`), backed by a
throwaway in-memory MongoDB (mongodb-memory-server). No `.env`, running
database, or Redis is needed; the first run downloads a MongoDB binary.

- Test files sit next to the code as `*.test.ts` (a route group's tests in its
  folder).
- Rate-limit counts live in the app, in memory. A file that makes more requests
  to a limited path than one client may per window (e.g. `/auth`) builds its own
  app per test with `createApp(testConfig)` instead of sharing `app` (see
  `src/routes/auth/auth.test.ts`).
- `test/database.ts`: `startDatabase`, `stopDatabase`, `clearDatabase` (use as
  `beforeAll` / `afterAll` / `afterEach`), and `collection(database, name)` for
  seeding raw documents. It bypasses the models, so tests can also seed data
  that breaks the contract.
- `test/redis.ts`: an in-memory stand-in for `src/managers/redis-manager.ts`
  (same exports and behaviour, expiry by `Date.now()` so fake timers apply).
  Tests that log in, refresh, or log out mock the module with
  `vi.mock(import("../../managers/redis-manager.ts"), () => import("../../../test/redis.ts"))`,
  call `clearRedis` in `afterEach`, and inspect `storedSessions()`. Changing
  `redis-manager` means changing the stand-in to match (its `rotateRefreshToken`
  mirrors the Lua script); the script itself isn't covered by the tests, so
  check changes to it against a real Redis.
- `test/responses.ts`: `expectContractError(path)` asserts a `500` with the
  generic body when stored data breaks the contract.
- `test/routes.ts`: `definedRoutes()` lists every route the app defines, so a
  test can check it covers every route of a kind.
- Assert status codes, full response bodies, and errors. Cover the `400`
  (invalid params) and `404` (missing collection) paths, not just success.

See `src/routes/gallery/gallery.test.ts` for the pattern.
