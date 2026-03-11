# Ship

Commit all staged and unstaged changes, then push to origin.

## Steps

1. Run `git status` and `git diff` (staged + unstaged) to understand what changed.
2. Run `git log --oneline -5` to match the repo's commit message style.
3. Stage all changed and new files with `git add` (list files explicitly — avoid `git add .` or `git add -A`).
4. Write a commit message following this format:
   - First line: `<type>: <short summary>` (≤72 chars), e.g. `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
   - Blank line
   - Body: bullet points grouped by area (backend / frontend / etc.), one bullet per logical change
   - If `$ARGUMENTS` is non-empty, add a blank line then `Closes #$ARGUMENTS`
   - Always end with a blank line and `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
5. Commit using a heredoc so formatting is preserved.
6. Run `git push`.
7. Report the commit hash and message to the user.
