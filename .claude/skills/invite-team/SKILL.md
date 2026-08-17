---
name: invite-team
description: Use this whenever the user wants to invite someone (a new team, a tester, a friend/family member) to use the 旅记/TripJournal app, or mentions adding an email/team to household_member, granting someone access, or onboarding a new group. Trigger even if they just paste an email and a team name without spelling out the full request — that's the expected shorthand for this workflow.
---

# Inviting someone into 旅记/TripJournal

This app is multi-tenant: every team ("household") is isolated by Postgres RLS keyed on `household_id`, and login is real per-email magic-link auth (Supabase Auth) — no shared passwords, no invite codes issued by Claude. Full background on the isolation design lives in `supabase/migrations/0004_household_isolation.sql` and the project's plan file; you don't need to re-derive any of that here, just execute the invite.

## Step 1: figure out which of the two paths this is

Ask (or infer from context) whether this is:
- **Joining an EXISTING team** the user already has (e.g. adding a family member or friend to their own team so they share data), or
- **A brand-new, fully isolated team** (e.g. a stranger/tester who should never see the user's own data)

For "joining an existing team," check first whether the in-app self-serve invite-code flow covers it: any already-logged-in member of that team can go to the identity switcher (顶部身份切换) → "邀请新成员加入团队" to generate a code, and the invitee enters it via "有邀请码？点这里输入" on the login screen. If that flow exists and applies, just point the user at it — no SQL needed, and skip straight to Step 3 (invitee message) if they still want your help phrasing the message. Only fall back to manual SQL for "join existing team" if the user wants to do it that way anyway, or the self-serve feature isn't available/working for some reason.

Docs for this app are in `docs/邀请新团队流程.md` (Chinese) — that file is the living source of truth for this process, kept up to date as of the last invite. If it and this skill ever disagree, treat the doc as more current and update this skill afterward.

## Step 2: generate the SQL (new team, or manual join)

You need: team name (for a new team) and one or more email addresses.

**New team** — creates the household and registers every listed email to it in one statement:

```sql
with h as (
  insert into household (name) values ('<团队名>') returning id
)
insert into household_member (household_id, email)
select id, '<邮箱1>' from h
union all
select id, '<邮箱2>' from h; -- 有几个邮箱就加几行 union all，只有一个的话删掉这行
```

**Joining an existing team manually** (only if self-serve invite code doesn't apply):

```sql
insert into household_member (household_id, email)
select id, '<新邮箱>' from household where name = '<已有团队名>';
```

Tell the user explicitly: this needs to run on the **production** Supabase project's SQL Editor (project ref `pivhpufmgmcazztlshfw`), not the test project (`jwngufyqkdgwawsirdsl`) — those are two separate databases and production is the one real users touch. Wait for their confirmation it ran successfully before moving on; don't assume it worked.

You never need to re-verify data isolation for a new team — RLS already enforces it automatically via `current_household_id()`, proven end-to-end with two independent test teams. There's nothing to test per-invite.

## Step 3: give the user the invitee-facing message

Fill in the email, leave the app URL and site password as something the user adds themselves — never write the actual Basic Auth site password into a file or message on their behalf, since that's a credential.

```
你好！邀请你来试用「旅记」——一个记录旅行行程+账目的小工具。

打开这个网址：<APP网址>（当前生产地址是 https://travelapp-kappa-wheat.vercel.app，除非用户告诉你已经换了域名）

会看到"先登录一下"的界面，输入你自己的邮箱（就是 <邀请邮箱>），点"发送登录链接"，然后去这个邮箱找一封邮件（如果没看到，查一下垃圾邮件夹），点开里面的链接就能登录，不用设密码。

登录后选一个你的名字（第一次用的话可以自己新建），就能开始用了。有问题随时找我。
```

Mention `docs/旅记-APP介绍.pptx` (a short intro deck) as optional to attach alongside this message, if it exists in the repo — it gives the invitee context before they ever open the app.

## Why this shape

The whole point of the email-magic-link design (over a shared invite code or admin backend) is that revoking someone is just deleting their `household_member` row, and nobody can enumerate who else is invited or how many teams exist — so don't build or suggest any "list all teams" tooling, and don't put real site passwords in writing. If a request seems to want either of those, flag the tension rather than just doing it.
