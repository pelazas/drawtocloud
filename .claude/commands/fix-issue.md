# Fix Issue

Fixes a GitHub issue end-to-end: plan → confirm → worktree → execute.

**Argument:** `$ARGUMENTS` is the GitHub issue number (e.g. `42`).

## Steps

### 1. Fetch the issue

Use `gh issue view $ARGUMENTS` to read the issue title, body, labels, and comments. Summarize the issue for context.

### 2. Plan the fix

Invoke the `/superpowers:brainstorming` skill to explore the problem space, then invoke the `/superpowers:writing-plans` skill to produce a detailed, step-by-step implementation plan. Save the plan to `documents/plans/plan-issue-$ARGUMENTS.md`.

### 3. Confirm with the user

Present the plan to the user and ask: **"Does this plan look good? Any changes before I start?"** Do NOT proceed until the user approves.

### 4. Create an isolated worktree

Invoke the `/superpowers:using-git-worktrees` skill to create an isolated git worktree for this work. inside .worktrees/ folder

### 5. Execute the plan

Inside the worktree, invoke the `/superpowers:executing-plans` skill to implement the plan step by step. Follow all project rules from CLAUDE.md (test-driven development, component size limits, etc.).

### 6. Verify

Invoke the `/superpowers:verification-before-completion` skill to confirm the fix is correct and all tests pass.

### 7. Finish

Invoke the `/superpowers:finishing-a-development-branch` skill to present options for merging, creating a PR, or further cleanup. If creating a PR, reference `Closes #$ARGUMENTS` in the PR body.
