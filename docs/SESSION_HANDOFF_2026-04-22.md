# AGC Desk — Session handoff (2026-04-22)

## TL;DR
Deep session day. Shipped ~15 commits across Desk + WP plugin. No known broken state. Railway + Vercel auto-deploy; Railway DB has migrations **030** (clients.exclude_from_reports) + **031** (historical_invoices) applied in prod.

## What shipped today

**CRM admin:**
- **`907ac13`** — `clients.exclude_from_reports` flag; flipped on for both Hunter Rhodes client rows (`79d5f143...` + `6de4829a...`). Hides their invoices from `/admin/invoices` list (all tabs), `/admin/kpi` rollup, `/admin/kpi/wholesale-owed`. Invoices still exist + reachable by direct URL.
- **`edb7261` + `7c068d5`** — Sidebar reorg. Invoices group (→ New invoice, Wholesale AR). Catalog group (→ In Stock Sheet, What We Pay). Price Sheet kept top-level.
- **`0674c26`** — Global React Query defaults: `staleTime: 55s`, `placeholderData: keepPreviousData`, plus 5s in-memory TTL cache on `GET /admin/products`. Kills 60s-poll flicker.
- **`4293a1c`, `e0552ae`** — Price Sheet: % of spot is now the hero figure on the "We pay" column, 2-decimal precision. Added Buy premium column left of We pay, Sell premium right of We sell.
- **`5cea5b7`** — Tony Davis (`tdavis321@gmail.com`) re-enabled — was `status='disabled'` from April 20 21:37, now `active`, `failed_login_count=0`. Role stayed admin per user.
- **`ff32719`** — Client portal catalog endpoints widened to `admin + staff + client`. Was the cause of empty `/dashboard/pricing` + `/dashboard/in-stock` when Hunter browsed as admin. Invoice endpoints still client-only (need `clients.user_id` linkage admins don't have).
- **`9b72d2f`** — Historical invoices feature (migration 031 + new module at `apps/api/src/historical-invoices/` + page at `/admin/historical-invoices`). Day-granular per-past-invoice entry, totals only, CSV bulk import, admin-only. UNIONed into KPI rollup alongside `kpi_manual_entries` (monthly). Complementary: monthly for broad backfill, day-level for per-invoice precision.
- **`216c639`** — In-Stock Sheet inline AGW/ASW editor per row. Extends `UpdateProductDto` with `metal_content_troy_oz`. Backend holds gross weight constant, back-solves purity. Label swaps by metal (AGW/ASW/APW/APdW).
- **`20e15e2`** — Calendar attendees auto-create CRM clients on page load (external emails only; `@atlantagoldandcoin.com`, `@atlantagoldandcoinbuyers.com`, `@agcdesk.com` excluded from auto-create via `INTERNAL_DOMAINS` constant in `apps/web/src/app/admin/calendar/page.tsx`).

**WordPress plugin (zip at `E:\agc-crm\wordpress-plugin\agc-inventory-v2.zip`, currently v2.6.2):**
- **`22c795e` (v2.5.1)** — Hidden premium column shows "% of spot" only (no dollar delta). Actual share form, not delta form.
- **`efbe4e8` (v2.5.0)** — Hidden premium reveal via double-click on hero LIVE badge. Mobile polish pass.
- **`0cab1a9` (v2.6.0)** — New `[agc_schedule_drawer]` shortcode, pill label changed to "Schedule an Appointment", glowier pill with halo animation, mobile pill moves to bottom-right thumb zone.
- **`962282a` (v2.6.1)** — Sitewide drawer toggle on the Settings → AGC Inventory page with Gravity Form id selector. Hooks `wp_footer`. Dedupe via static flag in `agc_inv_render_schedule_drawer()` first-call-wins.
- **`9be7521` (v2.6.2)** — Moved CSS/JS enqueue to `wp_enqueue_scripts` (was too late at `wp_footer` on some themes). Added diagnostic comments in page HTML: `<!-- AGC sitewide drawer: ON -->` vs `OFF`. Settings page now shows colored ● ON / ● OFF status indicator. Hidden sentinel input so unchecking persists.

## Current state

- `main` is at `20e15e2`. Clean working tree.
- Production Railway DB has all migrations through 031.
- Plugin v2.6.2 built; **user uploaded AND enabled the sitewide drawer toggle** — last confirmed working after the v2.6.2 enqueue-timing fix.
- Hunter + accounting@atlantagoldandcoin.com + Tony Davis (tdavis321) all have `role='admin'`, `status='active'`.

## Worktrees on disk (side-chat leftovers, not relevant)
`git worktree list` shows three `.claude/worktrees/*` branches. None have accounting-invoice work. User mentioned a "side chat" working on accounting; the kpi-manual / historical-invoices features were mine on main. Side chat either hasn't pushed or was closed without committing.

## Open follow-ups
1. **Notify-me restock sender** — migration 029 + signup endpoint + OOS section in Live Inventory widget all shipped. Missing: the worker that fires the email when qty goes 0 → positive. Need from user: email template copy (subject + body), trigger-path decision (which stock-return events fire), SMTP password rotation confirmation, unsubscribe flow preference (one-click vs preference center), rate-limit tolerance, whether admin wants a per-product "restock queue" view.
2. **Accounting side chat** — user said a separate agent was working on accounting-invoice line items. Nothing pushed. Can pick it up if they confirm side chat is dead.
3. **Client portal spot cards** — showed `—` in a screenshot earlier. May have been resolved by the `ff32719` role-gate widening. Needs user to re-check `/dashboard/pricing` after that deploy.
4. **kpi_manual_entries UI** — currently enforces one-per-month. If accountant needs multiple amendments per month with audit trail, relax the constraint (~10 min).
5. **"Refresh from carriers"** button — still pending user to click and report what flash message appears, for UPS tracking diagnosis.
6. **OCR** — AWS creds wired in Railway, still waiting on first driver's license upload to verify green "OCR ✓" badge.

## Key paths for orientation
- Pricing math doc explained verbally to user this session. Code at `apps/api/src/pricing/pricing.service.ts`.
- Historical invoices: `apps/api/src/historical-invoices/` + `apps/web/src/app/admin/historical-invoices/page.tsx`.
- Plugin: `wordpress-plugin/agc-inventory/agc-inventory.php` (v2.6.2), assets under `wordpress-plugin/agc-inventory/assets/`.
- Production DB: Railway Postgres (see Railway → API service → Variables → `DATABASE_URL`). Do NOT paste the live URL into tracked files; GitGuardian will flag it instantly.
- Run migrations: `cd apps/api && DATABASE_URL='<from Railway variables>' pnpm db:migrate`.

## User context for next session
- Low on usage this session (the reason for this handoff).
- Getting ready to have accountant start booking historical invoices (feature just shipped).
- WP sitewide drawer is live on their shop site.
- Hunter's own invoices now excluded from reports via the exclude flag.
