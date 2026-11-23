---
paths:
    - "src/**/*.ts"
    - "test/**/*.ts"
    - "*.config.*"
---

# Naming

This is a production codebase that people read and review: a name should tell a
reader what something is or does without opening its definition. Short is good
when it's still clear in context (`results` in a function with one kind of
result, `i` in a short loop); generic is not (`data`, `item`, `value`, `info`,
`handle`, `process`, `temp` once a scope holds more than one candidate).

## Descriptive names

- Name for what it is or does in this domain, not its type or the code's
  mechanics: `storedPost`, not `data`; `mapSeasons`, not `list`.
- Disambiguate when a scope holds several similar things: `newsResults` and
  `galleryResults`, not `results` and `results2`.
- A function name says what it does to what. If a reader would ask "what in
  order?" or "converts what?", it's too vague: `processInOrder` or
  `writeItemsInOrder`, not `inOrder`. If the honest name needs "and", the
  function likely does too much (split it).
- Abbreviations common in web development are fine (`url`, `id`, `req`, `res`,
  `err`, `ms`, `ttl`); spell out ones a reader would have to decode
  (`refreshToken`, not `rt`).

## Casing and form

- `camelCase` for variables, functions, properties, and methods.
- `PascalCase` for classes, interfaces, and types. No `I` prefix on interfaces
  (`NewsPost`, not `INewsPost`).
- `SCREAMING_SNAKE_CASE` for fixed, module-level constant values
  (`JSON_BODY_LIMIT`, `SESSION_IDLE_TIMEOUT_MS`). Include the unit in the name
  when there is one.
- Booleans (variables, properties, parameters) read as a yes/no question with an
  `is`, `has`, `should`, `can`, or `was` prefix: `isFinished` or `hasFinished`,
  not `finished`; `isStale`, not `stale`. Exception: names fixed outside the
  code, like contract fields the website reads, stored fields, and options of a
  library's API.
- Functions and methods are verb phrases (`parseResponse`,
  `updateContentVersion`). A function that retrieves something starts with the
  verb that says so: `get` for a read that returns what was asked for, from
  MongoDB, Redis, Discord, or derived (`getNewsPosts`, `getIdentity`), `find`
  when it may return nothing, `create`/`build`/`to` for new values
  (`toSession`). A function returning a boolean reads as a question
  (`isSafeMethod`, `hasGalleryCollection`).
- Middleware is named for what it does to the request (`requireLogin`,
  `cacheByContentVersion`), not when it runs.

## Files

- kebab-case, named for the one concept they hold (`session-cookie.ts`,
  `rate-limits.ts`); tests sit next to the code as `<name>.test.ts`.
- Put files where `CLAUDE.md`'s architecture says.
