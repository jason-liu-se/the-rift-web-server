---
name: add-endpoint
description:
    Add or change an endpoint of The Rift web server (a new route, query
    parameter, or response field). Use when asked to add, change, or remove an
    API endpoint or what it returns.
argument-hint: <endpoint and what it returns>
---

Add or change the endpoint described in: $ARGUMENTS

Read `.claude/rules/database.md` first.

## 1. Check the website

Read `../website/src/app/services/` for how the website calls this area. If the
change breaks an existing call (renamed field, new required parameter, different
status code), stop and raise it with the user before continuing.

## 2. Contract

Add or change the response type in `src/contract/api-responses.ts`. Keep the
file dependency-free.

## 3. Schemas

- Response: add or update a schema in `src/routes/response-schemas.ts`, typed
  with `z.toZod<ContractType>()`, until `npm run typecheck` passes.
- Input: reuse `collectionParams` and `paginationQuery` from
  `src/routes/query-schemas.ts`, or add a schema there.

## 4. Data access

Add, edit, or reuse a function in `src/helpers/mongo-manager.ts`. Keep reads
bounded, and let MongoDB filter, sort, and paginate. A new database needs a
model in `src/models/`, and its database added to `DATABASES` in
`test/database.ts`.

## 5. Route

In the router for its URL prefix (or a new one mounted in `src/app.ts`): parse
the input, check the collection exists if it takes one, call `mongo-manager`,
and send the body through `parseResponse`. Don't catch errors.

## 6. Tests

Add tests in the router's `*.test.ts` (`.claude/rules/testing.md`): the success
body, the `400` and `404` paths, and `expectContractError` for stored data
missing a required field. Then run:

```bash
npm run typecheck && npm run lint && npm test
```

## 7. Finish

- Update the README's endpoint table.
- Tell the user to run `npm run api:sync` in `../website` and update its
  services.
