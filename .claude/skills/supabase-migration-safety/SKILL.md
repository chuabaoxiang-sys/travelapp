---
name: supabase-migration-safety
description: Use this whenever writing a new supabase/migrations/*.sql file for the 旅记/TripJournal app, or when the user wants to change the database schema, add a column, change RLS policies, or otherwise modify the Postgres structure this app relies on. Also trigger if the user asks to "migrate" data, backfill a column, or run SQL against either the test or production Supabase project. This app holds real family financial data in production — treat every schema change with the same care as the household-isolation migration that established this process.
---

# Safe Supabase migrations for 旅记/TripJournal

This project's database changes go through the user manually pasting SQL into Supabase's dashboard SQL Editor — never through an automated connection or a `service_role` key in running code. That's a deliberate, established principle (born from the multi-tenant isolation work): Claude generates exact SQL, explains what it does and why, and the user executes it themselves. Don't try to shortcut this by reaching for a database connection tool even if one is technically available — the user has been explicit that they want to see and run every statement that touches their real data.

There are two Supabase projects: **test** (`jwngufyqkdgwawsirdsl`) for proving a migration is safe, and **production** (`pivhpufmgmcazztlshfw`) which holds the real family data everyone actually uses. Every migration goes to test first, always — no exceptions for "this one's simple."

## The sequence

**1. Write the migration file**

New file under `supabase/migrations/`, following the existing numbering (currently up to `0005`). Match the existing style: Chinese comments that explain *why* a design choice was made, not just what the SQL does — future-you (or future Claude) needs the reasoning, not a restatement of syntax. Look at `0004_household_isolation.sql` for the tone and level of detail expected.

**2. Run it on the test project first**

Give the user the exact SQL to paste into the test project's SQL Editor. Wait for confirmation before proceeding — don't assume success.

**3. Watch for the bulk-UPDATE-then-ALTER trap**

If the migration both (a) does a bulk `UPDATE` on an existing table — e.g. backfilling a new column on rows that already exist — and (b) then runs `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` (or other DDL) on that *same* table, split these into two separate pastes run as two separate transactions in the SQL Editor.

Why this matters and why testing alone won't catch it: Postgres throws `55006: cannot ALTER TABLE ... because it has pending trigger events` when a table's rows have real foreign-key relationships and you try to alter its structure in the same transaction as a DML statement that touched those rows. This is exactly what happened running `0004` against production: the test project was empty, so the backfill `UPDATE` touched 0 rows and no trigger fired — it looked completely clean. Production had real rows with real foreign keys, and the *identical* SQL failed there. A clean test-project run is NOT proof the same script is safe on production if this pattern (bulk update + same-table DDL) is present — proactively split it before running on production, don't wait to hit the error.

**4. Before touching production: confirm a backup exists**

This project is on Supabase's Free tier, which has **no automatic backups** — Database → Backups will literally say "Free Plan does not include project backups." If the migration changes schema in any way that could affect existing data access (new NOT NULL columns, RLS policy changes, anything non-additive), get a manual backup first:
- Table Editor → export each affected table as CSV, or
- The app's own built-in Excel/JSON export (`domain/export.ts`) for a lighter business-data snapshot

Don't skip this because a migration "looks small" — the household-isolation migration felt routine right up until the production-only trigger error surfaced, and having the backup ready meant that wasn't a crisis when it happened.

**5. Run on production, confirm, then check what else needs to ship**

A schema migration landing on production doesn't mean the feature is live — cross-reference with the `deploy-verification-checklist` skill: does the frontend code that uses this new schema also need deploying? Do any Supabase Auth settings need configuring to match? `0004` needed all three (migration + code deploy + auth config) before it actually worked end-to-end; `0005` was additive-only (a new function, no schema/data changes) and only needed the SQL run on both projects plus a code deploy, no backup step.

## Reporting back

State plainly which project(s) the migration has been run on so far, and what's still pending — "test only" is a normal, expected mid-process state, not a mistake, but don't let it get confused with "done."
