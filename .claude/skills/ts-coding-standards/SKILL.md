---
name: ts-coding-standards
description:
    Use when writing, reviewing, or refactoring TypeScript code. Provides type
    safety patterns, error handling, async programming, and security guidelines.
allowed-tools: Read, Grep, Glob
---

<!-- Adapted from https://github.com/tacogips/claude-code-agent/tree/94624e601aa3b2a0fcadfda483228680ba1904e9/.agents/skills/ts-coding-standards (MIT, (c) tacogips). Trimmed to general guidance and aligned with this repo. -->

# TypeScript Coding Standards

General TypeScript guidance for this project.

**Precedence:** `CLAUDE.md` and the repo's config (`.prettierrc`,
`.editorconfig`, `eslint.config.js`, `tsconfig.json`) override anything here.
Formatting is Prettier's job; don't hand-format against it.

## When to Apply

- Writing new TypeScript code
- Reviewing or refactoring existing TypeScript code
- Designing module APIs and interfaces
- Implementing error handling

## Core Principles

1. **Type Safety Over Convenience** - Never sacrifice type safety for shorter
   code.
2. **Explicit Over Implicit** - Make types and intentions clear.
3. **Simple Over Clever** - Prefer readable code over clever abstractions.
4. **Fail Fast** - Catch errors at compile time, or at the boundary at runtime.

## Quick Reference

### Must-Use Patterns

| Pattern                                     | Use Case                                                |
| ------------------------------------------- | ------------------------------------------------------- |
| Discriminated unions                        | State machines, variant results, error kinds            |
| Union of string literals / `as const` array | Fixed value domains (modes, statuses, kinds)            |
| Branded types                               | IDs, emails, other validated strings                    |
| `readonly`                                  | Data that should not mutate                             |
| `unknown` in `catch`                        | Safe error handling                                     |
| Explicit `undefined` checks                 | Indexed access (`noUncheckedIndexedAccess` is enabled)  |
| Runtime validation (Zod)                    | Anything from outside the process: requests, env, files |

### Must-Avoid Anti-Patterns

| Anti-Pattern                               | Alternative                            |
| ------------------------------------------ | -------------------------------------- |
| `any`                                      | `unknown` with type guards             |
| `as` assertions on external data           | Parse with a Zod schema                |
| Plain `string` for a fixed set of values   | Union of string literals               |
| `enum`, `namespace`, parameter properties  | Erasable syntax only (see `CLAUDE.md`) |
| Swallowing errors in an empty `catch`      | Handle, or rethrow / let it propagate  |
| Floating promises (`forEach(async ...)`)   | `await` or `Promise.all`               |
| Barrel files that re-export a whole folder | Import directly from the source file   |

## Files and Modules

- kebab-case file names; one cohesive responsibility per file.
- Keep files small enough to read in one sitting. If a file you touch is growing
  past a few hundred lines, consider splitting it along a clear boundary, or
  raise it with the user.
- Dependencies point inward: models don't import routes; data access doesn't
  know about HTTP.
- Tests sit next to the code they cover.

## After Coding

Run the checks listed in `CLAUDE.md` (type-check, lint, tests) and fix failures
before calling the work done.

## Detailed Guidelines

- [Type Safety](./type-safety.md) - strict-mode patterns, branded types, type
  guards, fixed value domains
- [Error Handling](./error-handling.md) - safe catch handling, error classes,
  expected vs exceptional failures
- [Async Patterns](./async-patterns.md) - concurrency, unhandled rejections,
  timeouts, retries
- [Security](./security.md) - keeping credentials and host details out of code,
  logs, and docs
