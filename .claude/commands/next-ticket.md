Review the current state of the codebase and write the next development ticket.

## Instructions

1. **Find the last ticket** — list all files in `tickets/` sorted by name, read the most recent one to understand its scope and acceptance criteria.

2. **Audit against acceptance criteria** — for each criterion in the last ticket's Verification section, check whether it is actually implemented in the codebase. Look at the relevant source files, not just whether a file exists.

3. **Check CLAUDE.md MVP scope** — cross-reference the MVP checklist in `CLAUDE.md` to identify which in-scope items are still unimplemented.

4. **Identify what's next** — determine the smallest coherent slice of work that:
   - Completes any unfinished items from the last ticket first
   - Then tackles the next logical MVP feature
   - Can be implemented and verified end-to-end in one ticket

5. **Write the ticket** — save it to `tickets/TICKET-NNN.md` (increment from the last ticket number) using exactly this format:

```
# TICKET-NNN — <Short Title>

## Context

<2-4 sentences explaining what this ticket delivers and why it's next.>

---

## Scope Assessment vs CLAUDE.md

### Aligned
- <feature> ✅

### Adjustments / Decisions
1. **<topic>:** <rationale>

---

## Implementation Order

### 1. <Phase name>
- <concrete step with file path>
- <concrete step with file path>

### 2. <Phase name>
- ...

---

## Critical Files

| File | Role |
|---|---|
| `path/to/file` | What it does |

---

## Verification (Acceptance Criteria)

1. <Specific, observable, testable criterion>
2. ...
```

6. **Output a summary** — after saving the file, print:
   - The ticket number and title
   - The 3 most important implementation steps
   - The file path where the ticket was saved
