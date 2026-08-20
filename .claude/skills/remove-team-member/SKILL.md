---
name: remove-team-member
description: Use this whenever the user wants to remove, kick out, revoke access for, or delete someone from a 旅记/TripJournal team — including phrases like "把X移除出我的Team", "取消他的访问权", "删除这个成员", "他不该再看到我们的账目", or just pasting an email and saying to take them out. Also use when someone is being moved to a different team, since that requires removing them from the current one first.
---

# Removing someone from a 旅记/TripJournal team

The single most important thing to get right: **"removing someone" is two independent operations, and people usually only think of one of them.**

| What | Table | Effect | How |
|---|---|---|---|
| **Access** — can this email read/write the team's data at all | `household_member` | RLS checks this live, so deleting the row cuts access immediately | **SQL only** (no UI exists) |
| **Identity** — the name they picked inside the app (记账时的"付款人"名单里那个名字) | `member` | Cosmetic/historical; removing it does NOT revoke access | **Do it in the app**, SQL only as fallback |

Doing only the first leaves a stale name in every picker. Doing only the second leaves them with full read/write access to the family's real financial data. Usually the user wants both.

Always revoke **access first**, then clean up the identity — otherwise they can keep writing data while you're mid-cleanup.

## Step 1: revoke access (SQL, this is the part that matters)

Target the **production** Supabase project (`pivhpufmgmcazztlshfw`), not the test one (`jwngufyqkdgwawsirdsl`).

```sql
delete from household_member
where email = '<邮箱>'
  and household_id = (select id from household where name = '<团队名>');
```

Tell the user plainly:
- This is **fully reversible** — re-inserting the row restores access.
- If that was their **only** team, this email can no longer log in *at all* (login requires the email to already be invited — see `0005_invite_check_rpc.sql`). That is correct for a real removal, and it resolves itself if you later add them to a different team.
- Other family members' devices self-heal on the next sync (`pullAll`'s orphan deletion drops rows the server no longer returns). Nobody needs to do anything manually.
- The removed person's own device keeps its stale local copy but can no longer sync; any queued writes will now fail against RLS. If they're staying on as a tester in a *different* team, have them clear the site's browser data so their outbox doesn't sit there failing forever.

## Step 2: the identity record — prefer the app, not SQL

`src/domain/members.ts` already implements the whole decision tree, and `IdentitySwitcher.tsx` exposes it: the user taps the identity avatar → the member row's delete action. `memberHasHistory()` decides automatically between a hard delete and a deactivate. **Point the user at that instead of writing SQL**, so the SQL path can't drift from product behavior.

Reach for SQL here only when the app path is unavailable (e.g. the user isn't at a device, or the member belongs to a team they can't currently switch into).

### If you do need SQL: check the footprint first

`member` has **no email column** — the app never linked a login email to an identity record. So you cannot map email → member automatically. Identify the right row by `display_name` + `created_at`, and confirm with the user before deleting.

```sql
select
  m.id,
  m.display_name,
  m.is_active,
  m.created_at,
  (select count(*) from expense       where paid_by        = m.id) as as_payer,
  (select count(*) from expense       where recorded_by    = m.id) as as_recorder,
  (select count(*) from expense_split where member_id      = m.id) as split_rows,
  (select count(*) from settlement    where from_member_id = m.id
                                         or to_member_id   = m.id) as settlements,
  (select count(*) from feedback      where submitted_by   = m.id) as feedbacks
from member m
where m.household_id = (select id from household where name = '<团队名>')
order by m.created_at;
```

**All five counts are 0** → hard delete is safe:

```sql
delete from member where id = '<member的uuid>';
```

Always target the **uuid**, never `display_name` — names are not unique and a future namesake would be destroyed silently.

**Any count is non-zero** → a hard delete will be rejected by a foreign key. Deactivate instead, which is exactly what the app does:

```sql
update member set is_active = false, updated_at = now() where id = '<member的uuid>';
```

Deleting the underlying expenses/splits/settlements to force a hard delete **destroys real financial history**. Never do it as a default. Only proceed if the user explicitly asks after being told what will be lost, and show them the actual rows first.

## Foreign key reference (verified against the migrations)

Worth having on hand — this is what decides delete-vs-deactivate:

**`on delete restrict` — these block a hard delete:**
- `expense.paid_by`, `expense.recorded_by` (`0001_init.sql`)
- `expense_split.member_id` (`0001_init.sql`)
- `settlement.from_member_id`, `settlement.to_member_id` (`0002_settlement_feedback.sql`)
- `feedback.submitted_by` (`0002_settlement_feedback.sql`)

**`on delete set null` — these don't block, but the rows survive with no attribution:**
- `rate_book_entry.created_by` (`0003_sync_fixes.sql`)
- `itinerary_item.created_by`, `settlement.created_by` (`0012_activity_attribution.sql`)
- `wishlist_place.created_by` (`0016_wishlist_places.sql`)

**`on delete cascade`:** `trip_member.member_id` — that table has never been written to, so this is inert.

If the user asked to remove someone *completely*, check the set-null group too, because content they created stays behind:

```sql
select
  (select count(*) from itinerary_item  where created_by = '<uuid>') as itinerary_items,
  (select count(*) from rate_book_entry where created_by = '<uuid>') as rate_entries,
  (select count(*) from settlement      where created_by = '<uuid>') as settlements_created,
  (select count(*) from wishlist_place  where created_by = '<uuid>') as wishlist_places;
```

Note a small known gap: `memberHasHistory()` in `src/domain/members.ts` checks the six restrict columns plus `rateBookEntries.createdBy`, but **not** the three newer attribution columns from `0012`/`0016`. So the in-app delete will hard-delete someone whose only footprint is itinerary items or wishlist places, leaving those rows unattributed. That matches the FKs' intent and isn't a bug, but say so rather than letting the user discover it.

## Don't

- Don't verify isolation afterwards — RLS via `current_household_id()` handles it and was proven with two independent test teams. There's nothing to re-test per removal.
- Don't build or suggest any "list all teams / all members across teams" tooling. Team invisibility is a deliberate design property (see `0004_household_isolation.sql`'s header).
- Don't run any of this against the test project when the user means production, and never paste a `service_role` key into code — the user runs every statement themselves in the Supabase SQL Editor.

## Related

- Adding someone: the `invite-team` skill.
- Moving someone to their own team: remove them here **first**. As of now one email cannot cleanly be in two teams at once — `current_household_id()` (`0004_household_isolation.sql`) does `limit 1` with no `order by`, and the client makes the same unordered pick in `src/domain/household.ts`, so the two can disagree and writes get rejected by RLS. There is also no team-switcher UI.
