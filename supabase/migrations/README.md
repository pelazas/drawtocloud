# Supabase Migrations

## Naming Convention

All migration files must follow the format:

```
NNN_description.sql
```

- `NNN` — zero-padded sequential number (001, 002, ...)
- `description` — lowercase, snake_case summary of the migration

## Ordering Rules

1. **Unique numbers:** each migration must have a distinct number. Duplicate numbers cause non-deterministic execution order.
2. **Sequential gaps are allowed**, but numbers should reflect chronological order.
3. **Never reuse a number** after a migration has been applied to any environment.

## Adding a New Migration

1. Find the highest existing migration number.
2. Increment by 1 and zero-pad to three digits.
3. Name the file accordingly (e.g., `015_add_user_indexes.sql`).

## Existing Environments

Migrations in this project are currently applied manually, so renaming a file that has already been run does **not** re-execute it on existing databases.

> **Caution:** If you later adopt Supabase CLI auto-tracking (`supabase db push`), renaming an already-applied migration will cause it to re-run because the CLI tracks applied migrations by filename. In that workflow, use `supabase migration repair` or keep the original filename and create a follow-up migration instead.
