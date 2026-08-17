---
name: deploy-verification-checklist
description: Use this right after pushing to main / triggering a Vercel deploy for the 旅记/TripJournal app, or when the user asks whether a deploy went well, reports something broken right after a deploy, or says things like "部署好了吗" / "线上是不是有问题" / "刚上线的版本". Walks through the specific failure modes this project has actually hit, not generic deploy advice — don't skip it just because "it's probably fine."
---

# Post-deploy verification for 旅记/TripJournal

This project has hit three deploy-related failures so far, each caused by something that *looked* fine in code review but wasn't visible until the deploy actually went live. This checklist exists because those failures were each hit once, cost real debugging time, and are individually easy to forget under "the code is right, so it'll work." Run through all of it, not just the parts that seem relevant to the current change — some of these (like the SW check) cost nothing to verify even when unrelated to what changed.

## 1. Load the live site fresh and check it's not blank

Open the actual production URL (currently `https://travelapp-kappa-wheat.vercel.app`) in a normal (not incognito) tab and confirm it renders — not a black/blank page.

Context: this app is a PWA with a service worker, and a stale cached version once caused a fully blank page after deploy (old JS/CSS file names 404ing because Vite renames build output on every build). `src/main.tsx` now has a `controllerchange` listener that auto-reloads the tab when a new service worker takes over, which should make this self-healing going forward — but verify it actually loaded correctly rather than assuming the fix covers every edge case. If it IS blank: check DevTools Console for 404s on hashed asset files, then Application → Storage → Clear site data as the immediate fix, and treat it as a signal the auto-reload guard needs revisiting if it recurs.

## 2. Cross-check Supabase Auth settings between test and production

This is the single most-repeated mistake in this project's history: test project (`jwngufyqkdgwawsirdsl`) and production project (`pivhpufmgmcazztlshfw`) are **two fully separate Supabase projects**. Nothing configured in one project's dashboard carries over to the other, ever. If this deploy touches anything related to login/auth, or if ANY Supabase Auth dashboard setting was changed on the test project during this session, ask explicitly: does production need the same change?

Known settings that must match on both projects (check these even if the current change seems unrelated to auth):
- **Authentication → Settings → SMTP**: custom Gmail SMTP (chuabaoxiang@gmail.com) must be enabled on both — Supabase's default mailer has a rate limit far too low for real use (a handful of emails per hour), and hitting it silently breaks login for real users.
- **Authentication → URL Configuration → Site URL / Redirect URLs**: must point at the real production domain. This defaults to `localhost:3000` on a fresh/never-configured project and silently breaks every magic-link redirect if left unset.

## 3. Confirm any new SQL migration ran on BOTH projects

If a new file exists under `supabase/migrations/` from this session, check it was applied to production, not just the test project. Test-project-only is a common half-finished state — the mechanism being proven correct on test doesn't mean production has the schema/data it needs yet. See the `supabase-migration-safety` skill for the safe sequence to apply it.

## 4. Confirm the Basic Auth wall is still up

Visit the production URL in an incognito/private window — you should get a native browser username/password prompt (HTTP Basic Auth from `middleware.ts`) before any page content loads at all, not after. If content loads without a prompt, the Vercel env vars `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` may have been dropped or the middleware broke — this is a real access-control regression, treat it as urgent.

## 5. Smoke-test the actual login flow if auth/sync code changed

For any deploy touching `src/domain/household.ts`, `src/features/auth/`, `src/db/sync.ts`, `src/db/syncMapping.ts`, or RLS policies: send a login link to a known registered email on the live production site, click it, and confirm you land in the app with existing historical data intact (trips, expenses, etc. still visible). This is the check that would have caught the `localhost:3000` redirect bug immediately instead of discovering it live.

## Reporting back

After going through this, tell the user plainly which items you checked and what you found — don't just say "looks good," name the specific things verified (e.g. "SMTP configured on both projects, Site URL correct, login smoke-tested, basic auth wall confirmed"). If something needs the user's action (checking a dashboard setting you can't see yourself), ask for exactly that, the same way this project's actual deploys have gone — you can't see the Supabase or Vercel dashboards directly, so route those checks through the user.
