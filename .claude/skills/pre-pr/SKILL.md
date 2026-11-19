---
name: pre-pr
description:
    Pre-PR checks for The Rift web server. Runs typecheck, lint, format check,
    tests, and the build, then a code review of the branch. Use before
    committing a feature or opening a pull request.
---

Run every check below, even if an earlier one fails, then report.

## 1. Automated checks

Run these one at a time and capture each result (pipe long output through `tail`
for the summary and failures):

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Then the extra checks the branch's risk tier needs (`.claude/docs/workflow.md`
"Risk"): for Medium and up, check `../website/src/app/services/` for callers of
any changed path, parameter, status code, or field.

## 2. Code review

Use the `code-reviewer` agent to review the current branch against its base,
including any uncommitted changes. If the changes touch `src/auth/`, sessions,
`PUBLIC_ROUTES`, CSRF, CORS, rate limits, or query building, also run
`/security-review`.

## 3. Report

Give one short summary:

- **Checks:** pass or fail for each command. For failures, quote the relevant
  error lines.
- **Review:** the findings, most severe first.
- **Risk:** the tier and your confidence, with the evidence behind it.
- **Verdict:** ready for a PR, or the list of things to fix first.

Fix failing checks and Critical or Important findings that are in the branch's
scope, then re-run the affected checks. List the rest in the report (and the PR)
for the user to decide.
