---
name: add-env-var
description:
    Add, rename, or remove an environment variable of The Rift web server. Use
    when asked to make something configurable through `.env`.
argument-hint: <variable name and purpose>
---

Add the variable described in: $ARGUMENTS

1. Add it to `envSchema` in `src/config/env.ts`. Give optional variables a
   `.default()` with a named constant. Number variables need `z.coerce` (and
   `emptyAsUnset`, so `NAME=` counts as unset).
2. Read it from the `loadEnv()` result in `src/index.ts` and pass it where it's
   needed. Never read `process.env` directly.
3. Add it to the README's environment variable table.
4. Ask the user to add it to their `.env` and the production environment. Don't
   edit `.env` yourself.
5. Run `npm run typecheck && npm test`.
