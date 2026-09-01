---
name: invite-team
description: Use this whenever the user wants to invite someone (a new team, a tester, a friend/family member) to use the 旅记/TripJournal app, or mentions adding an email/team to household_member, granting someone access, or onboarding a new group. Trigger even if they just paste an email and a team name without spelling out the full request — that's the expected shorthand for this workflow.
---

# Inviting someone into 旅记/TripJournal

This app is multi-tenant: every team ("household") is isolated by Postgres RLS keyed on `household_id`. Login is per-email — the invitee gets a **6-digit code by email** and types it in; there are no passwords anywhere. Full background on the isolation design lives in `supabase/migrations/0004_household_isolation.sql`; you don't need to re-derive it here, just execute the invite.

Two facts that changed and are easy to get wrong from memory:
- **Login is a 6-digit code, not a magic link.** It was a clickable link until 2026-08-16, changed because a link opened in a different browser/app than the one that requested it always failed to log in. Never tell an invitee to "click the link in the email."
- **There is no site-wide password wall.** It existed until 2026-08-16 (`middleware.ts`, now deleted). Don't ask the user for it, don't leave a placeholder for it. The invitee goes straight to the login screen.

## Step 1: which of the two paths is this?

- **Joining an EXISTING team** the user already has (family member, someone who should share their data), or
- **A brand-new, fully isolated team** (a tester/stranger who must never see the user's own data)

If it's ambiguous — especially for a *tester* — **ask before doing anything**. Getting this wrong means handing someone full read/write access to the family's real financial records. A tester almost always wants their own isolated team.

### Joining an existing team → no SQL, point them at the in-app invite code

This is fully self-serve and shipped (`0007_household_invite_code.sql`, `src/features/members/InviteCodeSheet.tsx`):

1. Any logged-in member of that team taps the identity avatar (顶部身份切换) → **「邀请新成员加入团队」** → **「复制邀请码」**.
2. The invitee opens the app, taps **「有邀请码？点这里输入」** on the login screen, fills their own email in the *upper* field and the code in the field that appears below, then taps **「用邀请码加入」**.
3. That immediately sends them a login code, so they never press 「发送验证码」 separately.

Tell the user to send the code **separately** from the guide/link, so a forwarded message doesn't carry the code with it. A leaked code is fixable — the same sheet has a regenerate action that invalidates the old one.

### Brand-new isolated team → SQL (Step 2)

Self-serve creation of a *new* team was deliberately never built, so this path still needs the user to run SQL.

`docs/邀请新团队流程.md` covers the same process in Chinese for the user's own reference. If it and this skill disagree, this skill is more current — update the doc to match rather than following it.

## Step 2: SQL for a brand-new team

You need the team name and one or more emails.

```sql
with h as (
  insert into household (name) values ('<团队名>') returning id
)
insert into household_member (household_id, email)
select id, '<邮箱1>' from h
union all
select id, '<邮箱2>' from h; -- 有几个邮箱就加几行 union all，只有一个的话删掉这行
```

Manual join into an existing team (only if the invite-code path genuinely can't be used):

```sql
insert into household_member (household_id, email)
select id, '<新邮箱>' from household where name = '<已有团队名>';
```

Say explicitly that this runs in the **production** Supabase SQL Editor (project ref `pivhpufmgmcazztlshfw`), not the test project (`jwngufyqkdgwawsirdsl`) — separate databases, production is the one real users touch. Wait for confirmation it ran; don't assume.

Never re-verify data isolation per invite — RLS enforces it via `current_household_id()` and it was proven with two independent test teams.

## Step 3: hand the invitee something to follow

There's already a built guide covering all five steps with screen-by-screen illustrations, so don't hand-write instructions from scratch:

- `docs/旅记加入指引.html` — self-contained single file, good for desktop/archiving/printing. **Bad for phones**: an .html attachment usually opens as source code or not at all on iOS.
- The same guide is published as an Artifact (a shareable link) — best for a phone recipient. It is **private by default**; the user must enable sharing from the page's share menu first or the recipient just sees nothing.
- `docs/旅记-APP介绍.pptx` — optional 5-page intro to what the app is, useful alongside either of the above.

If the user would rather paste plain text into WhatsApp/WeChat, use this — the quoted button names are verbatim from `src/features/auth/EmailLogin.tsx` and must not be paraphrased:

```
你好！邀请你一起用「旅记」——记录旅行行程和账目的小工具。

网址：https://travelapp-kappa-wheat.vercel.app
邀请码：__________

iPhone 请用 Safari 打开（不要用 Chrome，苹果只允许 Safari 装成真正的App）

1. 打开上面的网址
2. 在「先登录一下」这屏，点蓝紫色按钮下面那行小字「有邀请码？点这里输入」（别直接点「发送验证码」，会提示邮箱没被邀请）
3. 上面那栏填你自己的邮箱，下面新出现那栏填我给你的邀请码，点「用邀请码加入」
4. 画面会跳到「查一下验证码」，同时邮箱会收到一封带6位数字的邮件（没看到翻一下垃圾邮件夹）。把6个数字填进格子，填满会自动登录，不用点确认
5. 出现「你是谁？」时，第一次用就在下面输入你的名字，点「添加」

有问题随时找我！
```

Leave the invite code as a blank for the user to fill — never invent one, and never put a real code into a file.

For a **brand-new team** (Step 2 path) the invitee has no code, so drop the 邀请码 line and step 2–3, and tell them to enter their email and tap 「发送验证码」 directly.

## Install-to-home-screen gotchas worth passing on

Both were discovered from real devices and both look like app bugs when they're really platform limits:

- **iPhone: only Safari can install it as a real app.** Chrome/Firefox/Edge on iOS cannot, even though their menus show a similar option. The app detects these and says so (`src/components/InstallPrompt.tsx`).
- **Opening the link inside WeChat/WhatsApp's built-in browser has the same problem.** Tell iPhone users to long-press the URL, copy it, and paste it into Safari.
- Android has none of this — the app pops its own install banner.

## Don't

- Don't suggest any "list all teams / all members" tooling. Team invisibility is deliberate (see `0004_household_isolation.sql`'s header).
- Don't put credentials of any kind in writing.
- Don't assume one email can only be in one team. That was true until 2026-08-21 and is no longer: `0017` made the team choice deterministic, `0018` added an active-team pointer, and the app has a switcher (`src/features/teams/TeamSwitcher.tsx`) that appears on the trip-picker screen once you belong to two or more. Adding an already-invited email to a second team is fine — they'll simply get a switcher row. What still isn't built is self-serve *creation* of a team, which is why Step 2 is manual SQL.

## Related

- Removing someone / moving them between teams: the `remove-team-member` skill.
- Schema changes: the `supabase-migration-safety` skill.
