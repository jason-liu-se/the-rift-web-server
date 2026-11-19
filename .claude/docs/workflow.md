# Workflow

How a task goes from branch to merged PR, and how much of the user's attention
it needs. The `orchestrate` skill runs this across parallel agents; the `pre-pr`
skill runs the checks and review for one branch.

## Risk

Risk decides where the user must be in the loop. Spend their attention on what
could do real damage, and let confident, low-risk work flow through. Rate each
task before starting it; the highest factor sets its **tier**.

| Factor        | Low                                            | High                                                                                                                                                                   |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blast radius  | One router and its tests, a new query          | Shared code: `src/app.ts`, `src/middleware/`, the error handler, functions other routes use in `mongo-manager`, models, `src/config/env.ts`                            |
| Reversibility | A revert fixes it                              | Lingers after a revert: cache headers (edge and browser copies), the refresh-token format or Redis script (sessions), stored data or indexes, Docker, CI, dependencies |
| Sensitivity   | Docs, a response field already in the contract | `src/auth/`, sessions, `PUBLIC_ROUTES`, CSRF, CORS, rate limits, query building (NoSQL injection), error bodies, the response contract (the website changes in step)   |
| Clarity       | Ready plan, existing pattern                   | Vague plan or a new pattern                                                                                                                                            |

After the work is done, rate your **confidence** (High / Medium / Low), backed
by evidence: tests that fail when the behaviour breaks, the website's callers
checked, a manual run. Confidence can only move a task up a tier, never down:
Medium moves it up one, Low makes it High.

| Tier   | User before starting | Checks                                                                                      | Review                                                     | User before merge                           |
| ------ | -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| Low    | —                    | typecheck, lint, format, tests                                                              | `code-reviewer`                                            | None into a feature branch; see below       |
| Medium | —                    | + the website's callers checked (`../website/src/app/services/`)                            | `code-reviewer`                                            | Reviews the PR                              |
| High   | Approves the plan    | + a manual run against real MongoDB and Redis (`npm run dev`, curl) where tests can't reach | + `/security-review` if sensitive, a read of the full diff | Reviews the draft PR and approves the merge |

The tests need no services, so every tier runs the whole suite.

## Branches and PRs

- Work on a branch, never `main`: `<type>/<issue>-<slug>` (`feature/14-…`,
  `fix/…`, `refactor/…`, `docs/…`). Sub-issues branch from, and open PRs into,
  the parent issue's branch.
- When a task is done and verified, commit in logical steps (one concern each),
  push, and open a PR without waiting to be asked; the PR is the review. Open it
  as a draft when the tier is High or confidence is Low. The body:

    ```markdown
    Closes #<n>.

    ## Summary

    - <what changed, by feature>

    ## Decisions

    - <choices the issue left open, and why>

    ## Testing

    - **Ran:** <each check, pass/fail>
    - **Not run:** <and why>

    ## Risk

    <tier> risk, <confidence> confidence: <one-line reason>. <follow-ups>
    ```

- **Never merge into `main`**: Northflank deploys it. Open the PR and leave the
  merge to the user, whatever the tier.
- Merge your own PR into a feature branch only when it's Low tier with High
  confidence, CI passed, and review left nothing Critical or Important
  (`gh pr merge --squash --delete-branch`). Everything else waits for the user.
- Never force-push or push to `main`.
- A contract change is two PRs, one per repo: this server's first, additive (new
  fields or routes, nothing removed), then the website's `npm run api:sync` and
  services. Remove the old shape only once the website no longer uses it.
- Several independent tasks can run in parallel agents and worktrees (the
  `orchestrate` skill; `.worktreeinclude` copies `.env`, run `npm ci` in each).
