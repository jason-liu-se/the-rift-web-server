---
name: orchestrate
description:
    Plan and run work for The Rift web server across several parallel agents in
    git worktrees, from issues or a request through to reviewed pull requests.
    Use when asked to orchestrate, parallelize, use multiple agents or
    worktrees, or work on several issues or sub-issues at once.
---

You are the orchestrator: you plan, brief, review, and integrate. Implementer
agents write the code. Keep your own context for decisions, not file dumps.
`.claude/docs/workflow.md` sets the risk tiers, branches, and merge rules you
apply.

## 1. Intake

1. Look for an existing plan of record (section 5) on the issue; if there is
   one, resume from it instead of re-planning.
2. Read every linked issue in full with comments
   (`gh issue view <n> --comments`), its sub-issues
   (`gh api repos/{owner}/{repo}/issues/<n>/sub_issues`), and any linked PRs.
3. Rate each issue as a plan:
    - **Ready**: concrete scope, acceptance criteria, and no open design
      choices. Use it as the plan.
    - **Partial**: clear goal, open details. Draft the missing parts.
    - **Vague**: a list of ideas. Draft a plan with scope cuts.
4. Read the code each task touches, enough to name real files. Check every path
   you'll put in a brief exists.

## 2. Rate the risk

Give each task a tier (`.claude/docs/workflow.md` "Risk"). It decides the checks
the implementer runs, the review you run, and where the user comes in:

- **High**: the user approves the plan before launch, the PR opens as a draft,
  and the user approves the merge.
- **Medium**: the user reviews the PR.
- **Low with High confidence**: you merge it into a feature branch once CI
  passes and no Critical or Important finding is open
  (`gh pr merge --squash --delete-branch`).
- **Never merge into `main`**, whatever the tier: Northflank deploys it. PRs
  into `main` stay open for the user.

The agent's confidence can only raise a task's tier. Say in your report which
PRs you merged and which wait for the user, and why.

## 3. Agree what can't be guessed

Before launching, settle each of these that isn't already decided:

- **Shared contracts**: anything two tasks both use (a `mongo-manager`
  function's signature, a query or response schema, a contract type, an error
  class). Write it down exactly; one task owns it.
- **Ownership**: which task owns each file or folder. Hot files shared by many
  features (`src/app.ts`, `src/api/public-routes.ts`,
  `src/api/query-schemas.ts`, `src/api/response-schemas.ts`, `src/contract/`,
  `src/managers/mongo-manager.ts`, `src/config/caching.ts`,
  `src/middleware/cache-control.test.ts`, `test/database.ts`, `README.md`) get
  one owner, or are marked append-only.
- **Order**: tasks that depend on another's output run after it, or after its
  contract is merged. Parallelize only independent tasks.
- **The website**: a contract change needs a website task too
  (`npm run api:sync` and its services), run from `../website` after this
  server's PR merges. Plan it, and list it as a follow-up; don't launch it from
  here.
- **Design direction and scope cuts**, when the issue leaves them open.

Ask in one round with the `grilling` skill's format (numbered questions, each
with your recommended answer), and only about what you can't decide from the
code, issues, or `CLAUDE.md`. If the user said not to ask, take your
recommendations and list them as assumptions in the briefs and your report.
High-tier plans always need the user's approval.

## 4. Branches

- Base: `main`, or the parent issue's branch for sub-issues (each sub-issue's PR
  targets it). Create the base branch if needed and check it out before
  launching: worktrees start from your `HEAD` (`worktree.baseRef: "head"`).
- Names follow `.claude/docs/workflow.md`: `<type>/<n>-<slug>`.
- Give agent `k` (from 1) its own dev server port, `PORT=40<k>0` (`4010`,
  `4020`, …; `4000` is yours), for manual runs. They share your MongoDB and
  Redis, so manual runs only read, never seed or flush.

## 5. Record the plan, then launch

Nothing you decide may live only in your context or an agent's prompt.

1. Post the **plan of record** as one comment on the issue (for work spanning
   several issues, on a new tracking issue that links them), starting with
   `<!-- orchestration-plan -->` so it can be found again:
    - tasks with their branch, base, tier, and owned files
    - shared contracts, written exactly
    - order and merge order
    - decisions, marked as the user's or your assumptions
    - a checklist of tasks, filled in with each PR link
2. Fill in [brief-template.md](brief-template.md) for each task, linking the
   plan comment, and launch the `implementer` agents in one message, in the
   background. Don't poll; you're notified when each finishes.
3. Keep the comment current (`gh api -X PATCH` on the comment): contract
   changes, new decisions, PR links, merges. If a contract changes, update the
   comment before telling any agent.

Decisions that outlive the work (a new shared pattern, a convention) go into
`.claude/docs/`, `.claude/rules/`, or code comments in the PR that introduces
them.

## 6. Review

For each finished agent:

1. Read its report and PR. Run the reviews the tier lists on the PR branch
   against its base. Point the reviewers at the agent's worktree (its completion
   notice gives the path), and wait for all of them before sending fixes, so the
   agent gets one list.
2. Send fixes back to the same agent (`SendMessage`), which keeps its context,
   rather than fixing them yourself. A fix round replays the agent's whole
   context, so send Critical and Important findings and only the cheap Minor
   ones; list the rest in the PR or a follow-up. Fix only trivial issues
   directly. If a fix needs files the task doesn't own, update ownership in the
   plan first. Findings outside every task's files go into a follow-up issue.
3. Before blaming a PR for a test failure, run the same test on the base.

## 7. Integrate

- Merge order: the contract owner first, then dependants in dependency order.
  Each later branch rebases onto the new base and resolves conflicts there,
  using the plan of record and both PRs to keep both sides' intent.
- Before the first merge, check for overlap:
  `git diff --name-only <base>...<branch>` for each branch, and
  `git merge-tree --write-tree <branch-a> <branch-b>` for conflicts. If the
  branches share files, or both touch shared code (`src/app.ts`,
  `src/middleware/`, `mongo-manager`, the contract), rehearse: merge them into a
  scratch branch, run typecheck, lint, and tests, then delete it. Otherwise skip
  it. Work that only becomes possible once both land gets its own follow-up
  task.
- Merge only what section 2 allows; never merge or push into `main`.

## 8. Report

Link the plan comment, then a table per task: PR link, tier, the agent's
confidence, checks (ran / not run), review findings left open. Then the PRs
waiting for the user, decisions made on the user's behalf, follow-ups (including
website tasks), and anything about this process that went wrong (fix this skill
if it caused it).
