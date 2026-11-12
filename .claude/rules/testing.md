---
paths:
    - "**/*.test.ts"
    - "test/**/*"
    - "vitest.config.ts"
---

# Testing

Vitest + Supertest integration tests: requests go to `app` from `src/app.ts`,
backed by a throwaway in-memory MongoDB (mongodb-memory-server). No `.env` or
running database is needed; the first run downloads a MongoDB binary.

- Test files sit next to the code as `*.test.ts`.
- `test/database.ts`: `startDatabase`, `stopDatabase`, `clearDatabase` (use as
  `beforeAll` / `afterAll` / `afterEach`), and `collection(database, name)` for
  seeding raw documents. It bypasses the models, so tests can also seed data
  that breaks the contract.
- `test/responses.ts`: `expectContractError(path)` asserts a `500` with the
  generic body when stored data breaks the contract.
- Assert status codes, full response bodies, and errors. Cover the `400`
  (invalid params) and `404` (missing collection) paths, not just success.

See `src/routes/gallery.test.ts` for the pattern.
