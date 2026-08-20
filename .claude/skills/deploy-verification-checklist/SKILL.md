---
name: deploy-verification-checklist
description: Use this right after pushing to main / triggering a Vercel deploy for the 旅记/TripJournal app, or when the user asks whether a deploy went well, reports something broken right after a deploy, or says things like "部署好了吗" / "线上是不是有问题" / "刚上线的版本" / "手机上还是旧版本". Walks through the specific failure modes this project has actually hit, not generic deploy advice — don't skip it just because "it's probably fine."
---

# Post-deploy verification for 旅记/TripJournal

Every item here corresponds to a failure this project actually hit in production, each of which looked fine in code review. Run through all of it, not just the parts that seem related to what changed — several cost nothing to check.

You cannot see the Vercel or Supabase dashboards yourself. Route those checks through the user and ask for exactly what you need.

## 1. Confirm the deploy actually reached the device

The fastest ground truth: in the app, **「···」更多 → 「检查更新」** shows the current build's git short SHA and build time. Compare it to `git rev-parse --short HEAD`. If they differ, the device is still running an old build — that is a *delivery* problem, not a code problem, and no amount of re-reading the code will explain it.

Order of suspicion when the version doesn't match:
1. **Vercel deploy didn't finish / failed.** Ask the user to confirm the latest deployment shows "Ready" and that its timestamp matches the push.
2. **Service worker still serving the old version.** This app is a PWA; Workbox precaches `index.html`, so a plain reload can be served entirely from the old SW's cache with no network request at all. "I refreshed and nothing changed" is almost always this, not a failed deploy.
3. Uncommitted local work — check `git status` / `git log` before assuming anything shipped. This project has had real cases where the code being discussed was never pushed at all.

Historical note worth knowing: until 2026-08-16 a newly installed service worker sat in "waiting" forever because nothing ever told it to take over, so devices could be permanently stuck on an old build no matter how many times the user refreshed. That's fixed (new SW activates immediately), but escaping it required a **one-time** clearing of site data on each already-stuck device. If a device is still stuck today, that one-time clear is the fix — it re-logs in, and cloud data syncs back.

## 2. Confirm the site loads and isn't blank

Open the production URL (`https://travelapp-kappa-wheat.vercel.app`) in a normal tab and confirm it renders. A stale cache once caused a fully blank page after deploy (old hashed asset filenames 404ing, since Vite renames build output every build). If blank: check the console for 404s on hashed assets, then Application → Storage → Clear site data.

There is **no password prompt** — the site goes straight to the login screen. A site-wide HTTP Basic Auth wall existed until 2026-08-16 (`middleware.ts`, now deleted); if you remember one, that memory is stale. Access control is now entirely: only invited emails can log in, plus per-team RLS.

## 3. Cross-check Supabase settings between test and production

The single most-repeated mistake in this project: test (`jwngufyqkdgwawsirdsl`) and production (`pivhpufmgmcazztlshfw`) are **two fully separate projects**. Nothing configured in one carries over, ever. If this deploy touched auth, or if any Supabase dashboard setting was changed on test during the session, ask explicitly whether production needs the same change.

Settings that must be right on **production** specifically:
- **Authentication → Settings → SMTP** — custom Gmail SMTP must be enabled. Supabase's default mailer allows only a handful of emails per hour, and hitting that limit silently breaks login for real users.
- **Authentication → Emails → Magic link / OTP template** — must be the **6-digit code** format, not a clickable link. Login was switched to codes on 2026-08-16 because a link opened in a different browser than the one that requested it always failed.
- **Authentication → URL Configuration → Site URL** — defaults to `localhost:3000` on a never-configured project. Codes don't rely on a redirect the way links did, but this still feeds email templates, so keep it pointed at the real domain.

## 4. Confirm any new SQL migration ran on production

If this session added a file under `supabase/migrations/`, verify it was applied to **production**, not just test. Test-only is a common half-finished state, and the app will look broken in ways that don't match the code. See the `supabase-migration-safety` skill for the safe sequence.

## 5. Verify server-only env vars if this deploy added or depends on one

This project has been burned **twice** by the same mechanism, so treat it as a first-class suspect rather than an afterthought: an env var marked **"Sensitive"** in Vercel becomes unreadable, so a corrupted value cannot be spotted by eye and the failure looks like a code bug. It happened to `VITE_SUPABASE_ANON_KEY` (every sync push failed with a non-ISO-8859-1 header error) and again to `ORS_API_KEY` (the directions proxy returned 502 with "no outgoing requests").

Standing rules that came out of those incidents:
- **Never mark a `VITE_*` var Sensitive.** It's compiled into the public JS bundle anyway, so hiding it removes your ability to verify it and buys zero security.
- When a server-side integration fails with no client-visible cause, the standard remediation is: delete the var, recreate it **without** Sensitive, verify the value character-by-character, then decide whether to re-mark it.

## 6. Smoke-test login and sync if that code changed

For deploys touching `src/domain/household.ts`, `src/features/auth/`, `src/db/sync.ts`, `src/db/syncMapping.ts`, or any RLS policy: on the live site, request a code for a known invited email, type it in, and confirm you land in the app with historical data intact (trips, expenses still visible).

Then check the **sync badge in the header**. It should settle on 「已同步」. If it sits on 「N条待同步」 for more than a minute, something is genuinely failing to push — that is not cosmetic. The fastest diagnostic is reading the outbox's stored error directly from IndexedDB in the browser console (`indexedDB.open('trip-journal')` → `outbox` → `getAll()`, look at each entry's `lastError`), which is far more direct than guessing from symptoms. That technique is what cracked both the anon-key and the expense-split-constraint bugs.

## Reporting back

Name the specific things you verified and what you found — not "looks good." For example: "HEAD is `abc1234`, the app's 检查更新 shows the same; production SMTP and the OTP email template confirmed by you; migration `0016` applied to production; sync badge settled on 已同步." State plainly which items you could not check yourself and what you need from the user.
