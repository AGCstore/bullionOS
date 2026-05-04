# Operator Guide

A short reference for day-to-day operation of BullionOS Desk. Aimed at the owner/admin who configures the system, not the staff who use it.

## First-run checklist

When you log in for the first time:

1. **Change your temp password** under `/dashboard/security`.
2. **Enable 2FA** on the same page — required for admin accounts. Use any TOTP authenticator (Google Authenticator, 1Password, Authy).
3. **Set branding** at `/admin/settings` — company name, address, phone, website, logo (PNG/JPG, ≤1 MB), favicon (.ico/.png).
4. **Configure features** at `/admin/settings/features` — toggle off anything you don't need.
5. **Add team members** at `/admin/users`.

## Branding

`/admin/settings` controls everything that says "your company name" across the app:
- Login subtitle
- Admin sidebar header
- Client portal header
- Invoice PDF header + disclosures
- EOD email subject + footer
- Push notifications

Logo + favicon are stored in the database, so they survive re-deploys.

The TOTP issuer label (what shows in your staff's authenticator app when they enroll) is set by the `TOTP_ISSUER` env var, not the in-app branding setting — needs a redeploy if you change it post-launch.

## Features

`/admin/settings/features` is a toggle UI for capabilities you can turn on/off without code changes:

| Flag | What it controls | Default |
| --- | --- | --- |
| `client_tracking_enabled` | New/Returning dashboard tile + `/admin/clients/tracking` page (driven by Google Calendar `(N)` / `(R)` tags) | on |
| `scrap_enabled` | Scrap calculator + scrap-invoice flow under `/admin/scrap` | on |
| `ifs_enabled` | IFS Clients FedEx-reseller shipping wizard. Requires an `ifs` integration. | off |
| `eod_reports_enabled` | Daily end-of-day email blast at 5 PM ET to admins/staff | on |
| `frontend_pricing_enabled` | Public buy-rate / live-pricing widgets (WordPress plugin uses these) | off |
| `compliance_photos_enabled` | ID + client + items photo capture on scrap invoices | on |

Configurable values (same page):

- `dashboard.new_clients_baseline` — your monthly new-clients goal. Shown beside the dashboard tile with a progress bar. `0` hides the baseline UI.
- `ifs.sender_match` — substring used to auto-pick your default sender from the IFS sender list. Empty falls back to IFS `primary_id`.
- `eod_report.from_email` — RFC From header for the EOD email (e.g. `Acme Coin <reports@acmecoin.com>`). Empty falls back to `SMTP_FROM`.
- `app.url` — canonical public URL of your app (used in email/PDF deep-links).
- `staff.email_domains` — comma-separated list of email domains your staff use. Drives the calendar attendee auto-create gate (so adding `sales@yourcoin.com` as an attendee doesn't create a customer record).

## Updating buy / sell pricing

Three places where pricing lives:

### 1. Spot prices (live)

Pulled automatically from metals.dev (via the central metals-proxy when configured). Cached for 30s on the API, polled every 30s by the UI when the tab is visible. You don't manage these.

### 2. Per-product premiums

`/admin/products/<id>/edit` — each product has:

- **Premium type**: `percent` or `flat`.
- **Premium buy**: what you'll pay above (or below, if negative) spot when buying this product from a customer.
- **Premium sell**: what you'll charge above spot when selling.

Example: a 1-oz Gold Eagle at `percent / +5 / +8` means:
- Buy price = `spot × purity × weight × (1 + 0.05)` ≈ `spot × 1.05`
- Sell price = `spot × 1.08`

### 3. Pricing rules (group overrides)

`/admin/pricing-rules` — rules that match by metal or by individual product. Use these to bump all silver coins by +2% during a market dip without editing each product. Rules apply on top of per-product premiums (most-specific match wins).

The price sheet at `/admin/pricesheet` shows the resolved final prices. Use it for the counter — staff can read the "We Pay" / "We Sell" columns directly to a customer.

## Imports (CSV bulk-load)

`/admin/imports` runs a two-step flow per entity:

1. Pick a CSV file → click **Preview (dry-run)** → review the row count + per-row errors.
2. Click **Commit N rows** → rows insert.

### Products CSV

Required columns: `sku`, `name`, `metal` (gold|silver|platinum|palladium).

Optional: `category` (coin|bar|round|numismatic|jewelry|other; default `other`), `weight_troy_oz` (default 0), `purity` (default 1), `description`, `is_active` (default true), `show_on_website` (default false).

Upserts on `sku` — re-importing the same SKU updates that row.

### Clients CSV

Required: at least one of `first_name` / `last_name` / `company`.

Optional: `email`, `phone`, `address_line1`, `address_line2`, `city`, `region`, `postal_code`, `country`, `notes`, `heard_from`, `client_type` (retail|wholesaler).

Existing client (matched by lowercased email) is left untouched — no overwrite. Empty-email rows always create.

### Historical invoices CSV

Required: `date` (YYYY-MM-DD), `type` (buy|sell), `amount`.

Optional: `client_email` (lookup), `client_name` (free-form), `is_wholesale`, `reference`, `notes`.

Lands in the `historical_invoices` table — feeds dashboard 12-month chart and KPI rollups but doesn't create real `invoices` rows. Use this for pre-system backfill, not ongoing transactions.

### Tips

- Open in Excel/Sheets and Save As → CSV (UTF-8). The parser handles quoted fields with commas/newlines.
- The first row must be the header row. Column names are matched case-insensitively.
- Bad rows are skipped, never block — good rows always commit.
- The whole batch runs in one transaction, so a runtime failure mid-import rolls back.

## Backups

`/admin/backups` lists every backup run (cron + manual). Daily backup runs at 8 PM local. You can:

- Click **Download** to grab a SQL dump of the production DB.
- Click **Run backup now** to trigger one ad-hoc.

**Important**: backups are stored INSIDE the database (in `backup_runs.dump_bytes`). Set up an off-site copy job (e.g. Backblaze B2 + a small cron) for disaster recovery. Don't rely on in-DB backups alone.

## Integrations

`/admin/integrations` is the single place to wire third-party services. Each provider stores its credentials encrypted (AES-256-GCM) in the `integrations` table:

- **Gmail** — for sending invoice emails + ingesting RARCOA price sheets. OAuth.
- **Google Calendar** — booking flow. OAuth.
- **GReminders** — appointment reminders + customer auto-create from confirmed appointments.
- **metals.dev** — only needed if you're NOT using the central metals-proxy.
- **Aurbitrage** — multi-wholesaler price aggregator. API key.
- **IFS Clients** — FedEx-reseller shipping labels. Username + password.
- **DocuSign** — e-signature. JWT-grant OAuth (Integration Key + RSA private key + User ID + Account ID).
- **UPS / FedEx / USPS** — direct carrier API. Most operators use IFS instead and leave these unconfigured.

Click **Test connection** on any provider after saving creds to confirm they work.

## Common operations

### Reset a user's password

`/admin/users/<id>` → **Reset password**. Generates a temp; user changes it on next sign-in.

### Reset a user's 2FA

If a user lost their authenticator: from the API host:

```bash
pnpm --filter @agc/api exec tsx src/db/disable-2fa.ts user@example.com
```

Or `/admin/users/<id>` → **Disable 2FA** if the UI surfaces it.

### Make a client owner-private

Some accounts (the owner's personal client record, an employee's testing record) shouldn't be visible to the rest of the team but should still flow into KPI rollups.

1. Edit the client at `/admin/clients/<id>/edit`.
2. Check **Owner-private (restricted visibility)**.
3. Only users with `users.can_view_owner_private = true` will see them.

To grant a user that capability:

```sql
UPDATE users SET can_view_owner_private = true
WHERE lower(email) = 'admin@yourcoin.com';
```

### Bulk-delete drafts

`/admin/invoices` → Drafts tab → check rows → click "Delete N drafts". Caps at 200 per batch.

### Rotate a tenant's metals-proxy key

See `apps/metals-proxy/README.md` § "Rotating a tenant's key" for the zero-downtime pattern.

## When something is wrong

- **Spot prices show "—"** — check `/admin/integrations` for the metals provider. If using the proxy, verify `METALS_PROXY_URL` + `METALS_PROXY_KEY` env on the API host. Hit `/api/v1/metals/spot` directly to see the error.
- **EOD email didn't arrive** — verify `eod_reports_enabled` is on. Check that at least one admin/staff user has `email_notifications=true`. Spot-check SMTP connectivity from `/admin/integrations`.
- **Calendar/GReminders not auto-creating clients** — check `staff.email_domains`. If your staff email domain isn't in there, the calendar won't differentiate them from customers.
- **Invoice PDF blank or broken** — usually missing branding logo. Confirm `/admin/settings` shows your logo, then re-render the PDF.
- **Login loops back to login page** — `JWT_SECRET` or `APP_ENCRYPTION_KEY` env was changed after the first user signed in. Existing session tokens are invalidated; users have to log in fresh, but the loop should stop after that.
