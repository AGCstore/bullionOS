# BullionOS Desk

Precious-metals trading desk, client portal, and integrated CRM. Licensable to coin dealers as a per-tenant deploy.

NestJS + Kysely + PostgreSQL + Redis + Next.js monorepo. Forked from `agc-crm` (Atlanta Gold and Coin's internal system); de-tenanted so each customer runs a private instance pulled from the same `main` branch.

## For operators

- **`docs/PROVISIONING.md`** — how to spin up a new tenant on Railway + Vercel (~30–45 min the first time).
- **`docs/OPERATOR_GUIDE.md`** — day-to-day reference: branding, features, pricing, imports, integrations, common operations.
- **`apps/metals-proxy/README.md`** — the central metals.dev fan-out service that consolidates all tenants onto one upstream API key.
- **`scripts/provision-tenant.sh <tenant-slug>`** — generates the per-tenant secrets + a paste-ready Railway env block.

## Repo layout

- `apps/api/` — NestJS API, runs on Railway. Per-tenant deploy.
- `apps/web/` — Next.js admin + client portal, runs on Vercel. Per-tenant deploy.
- `apps/metals-proxy/` — small Express service for shared metals.dev access. ONE central deploy that all tenants share.
- `docs/` — operator + provisioning guides.
- `scripts/` — provisioning + one-off tooling.

---

## Current state of the system

Everything below is implemented, wired end-to-end, and covered by tests or smoke scripts.

### Production-ready

- **Auth.** Email + password (bcrypt cost 12), JWT HS256 access tokens in memory, rotating refresh tokens as **`httpOnly; Secure; SameSite=Lax` cookies** scoped to `/api/v1/auth`. Refresh-token reuse detection revokes all user sessions. Account lockout after 10 failed attempts. TOTP 2FA with QR enrollment and 10 one-time recovery codes.
- **Products catalog + pricing engine.** Product override beats metal default, with percent *or* flat-per-troy-oz premiums. Decimal arithmetic end-to-end (`decimal.js` + `NUMERIC(20,8)`), never JS float.
- **Metals feed.** Live spot from metals.dev, Redis-cached with stale-on-upstream-failure fallback.
- **Invoices.** Create → finalize → paid → shipped state machine for both buy and sell sides. Each line item captures a full snapshot (name, gross weight, purity, metal content, spot, premium type/value, unit price, line total). **An invoice is 100% reproducible after the underlying product is hard-deleted.**
- **Admin override** on individual line items; admin role only, logged in `audit_logs`.
- **Invoice PDF** generated with pdfkit (logo upload + branding configurable in Settings).
- **Inventory with real reservation.** Sell-side `draft → finalized` reserves stock; `shipped` consumes it; `canceled` releases it. Buy-side `paid` adds stock. `SELECT ... FOR UPDATE` on the inventory row serializes concurrent finalize attempts, making oversell impossible. Weighted-average cost maintained on buy-side movements.
- **Public feed** `/public/what-we-pay`: batch-priced (~5 queries regardless of product count), Redis-cached with hook-based invalidation on product + pricing-rule changes.
- **Client portal** at `/dashboard/*` — transactions, invoice PDFs, live pricing via SSE, lock-in quotes, in-stock feed, deal requests with photo uploads, shipments with carrier tracking URLs, staff↔client messaging, 2FA setup.
- **Admin console** at `/admin/*` — dashboard with live spot ticker, clients CRM (pg_trgm fuzzy search), products, pricing rules, invoices (create wizard + status board), deal-request queue with inline photo gallery + messaging, shipments, inventory, lock-in quote converter, branding, integrations.
- **Notifications** — in-app inbox + email via nodemailer (SMTP or dev log) + SMS via Twilio (live or dev log). Per-user opt-in for email and SMS. SMS limited to high-signal events.
- **Integrations** — UPS / FedEx / USPS / DocuSign credentials configured in-app at `/admin/integrations`. AES-256-GCM encrypted at rest; secrets never leave the server (redacted in API responses, never in env). One master `APP_ENCRYPTION_KEY` is the only secret the env needs for these.
- **Shipment adapter** layer (`ShipmentAdapter` interface). Each carrier is an isolated adapter class; `CarrierService` is a thin dispatcher. A `shipment_tracking_events` table stores normalized event history with idempotent ingestion.

### Partially implemented — structure complete, needs external keys or one last wire

- **Carrier tracking auto-refresh.** `CarrierService.track()` + `ShipmentIngestService.ingest()` are wired. Admin "Test connection" exercises the real OAuth endpoints. Background polling job is not scheduled yet — expected wiring is a cron tick calling `ShipmentIngestService.refreshShipment(id)` per active shipment.
- **Carrier webhooks.** `CarrierWebhooksController` at `/api/v1/webhooks/carriers/:carrier` is live. Each adapter's `verifyWebhook()` / `parseWebhook()` methods are optional and currently only stubs; wire them when you enroll a carrier in push delivery.
- **DocuSign.** JWT-grant token exchange + HMAC webhook verification implemented. Envelope creation / template fill path is scaffolded but not wired to the invoice finalize flow yet.
- **EasyPost.** Adapter class present as a structural placeholder.

### Deliberately not planned

- ACH rails (Plaid / Dwolla).
- Mobile app — future.

---

## Repo layout

```
agc-crm/
├── apps/
│   ├── api/                  NestJS backend
│   │   ├── src/
│   │   │   ├── auth/         login, 2FA, refresh cookies, guards
│   │   │   ├── clients/      CRM + pg_trgm fuzzy search + portal enable/disable/reset
│   │   │   ├── client-portal/ /client/* endpoints
│   │   │   ├── common/       money helpers, decorators, filters
│   │   │   ├── config/       env schema (zod)
│   │   │   ├── crypto/       AES-256-GCM for integration creds
│   │   │   ├── db/           Kysely + all migrations (001..013)
│   │   │   ├── deal-requests/ + photo uploads
│   │   │   ├── email/        nodemailer (dev fallback)
│   │   │   ├── integrations/ carrier adapters + DocuSign + webhook controller
│   │   │   │   └── adapters/ ups, fedex, usps, easypost
│   │   │   ├── inventory/    on_hand + reserved counters, movement audit
│   │   │   ├── invoices/     create + state machine + PDF
│   │   │   ├── messages/     staff ↔ client threads
│   │   │   ├── metals/       spot feed + Redis cache + SSE stream
│   │   │   ├── notifications/ inbox + email + SMS fan-out
│   │   │   ├── price-quotes/ time-limited locked quotes
│   │   │   ├── pricing/      engine + rules + quoteMany batch
│   │   │   ├── products/
│   │   │   ├── public/       public pages + Redis cache layer
│   │   │   ├── redis/
│   │   │   ├── settings/     branding + logo upload
│   │   │   ├── shipments/
│   │   │   └── sms/          Twilio (dev fallback)
│   │   └── test/
│   │       ├── unit/         pricing math, carrier status mapping
│   │       └── integration/  invoice snapshot, reservation, oversell, public feed
│   └── web/                  Next.js 15 client + admin portal
├── packages/shared/          zod schemas shared with web
├── .github/workflows/ci.yml  lint + typecheck + migrations + build
├── docker-compose.yml        local Postgres 16 + Redis 7
├── render.yaml               production blueprint
└── README.md
```

---

## Setup

### Prerequisites

- Node 20.11+
- pnpm 9+
- Docker Desktop (Postgres + Redis)
- Git

### First-time

```powershell
cd E:\agc-crm
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/api/.env` and fill in:

- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — run twice:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
  ```
- `APP_ENCRYPTION_KEY` — 32 bytes base64:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
- `METALS_API_KEY` — grab from https://metals.dev

Install + boot:

```powershell
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed               # creates admin@agc.local / ChangeMe_Admin_123!
pnpm db:seed:trading       # seeds product catalog + pricing rules
```

### Run dev

Two terminals:

```powershell
pnpm api:dev    # http://localhost:4000
pnpm web:dev    # http://localhost:3001
```

Sign in at http://localhost:3001/login as `admin@agc.local` / `ChangeMe_Admin_123!` and **change the password immediately**.

---

## Running tests

Unit tests are pure and need no API:

```powershell
pnpm --filter @agc/api test:unit
```

Integration tests hit the live API and verify DB invariants. Need `pnpm api:dev` running:

```powershell
pnpm --filter @agc/api test:integration
```

Covers:
- pricing math (override precedence, percent vs flat, decimal safety)
- carrier status mapping (UPS / FedEx / USPS codes)
- invoice snapshot fidelity (gross/purity/content are three distinct values)
- invoice survives hard-DELETE of its product (totals + PDF unchanged)
- `buy.paid` → `+on_hand`
- `sell.finalized` → `+reserved` only; `sell.shipped` → consume both counters
- cancel → release reservation
- oversell rejected atomically via `SELECT FOR UPDATE`
- admin override persists `is_overridden=true` + `unit_price`
- `/public/what-we-pay` filters by `show_on_website=true`

CI (`.github/workflows/ci.yml`) runs lint + typecheck + migrations + build on every push.

---

## Migrations

13 applied migrations. Additive only — rename/nullable changes happen in dedicated migrations that note their safety guarantee in the header comment.

| #   | Purpose |
|-----|---------|
| 001 | auth: users, clients, refresh_tokens, audit_logs |
| 002 | trading: products, pricing_rules, inventory, inventory_movements, invoices, invoice_line_items |
| 003 | settings (branding, logo path) |
| 004 | portal: deal_requests, shipments, notifications |
| 005 | 2FA recovery codes, price_quotes, deal_request_photos, email prefs |
| 006 | pg_trgm fuzzy search indexes (clients, products, invoices) |
| 007 | messages (client↔staff) + phone/SMS prefs |
| 008 | integrations (encrypted credential store) |
| 009 | `invoice_line_items` column rename: `gross_weight_troy_oz`, `purity`, `metal_content_troy_oz` |
| 010 | product delete SET NULL on `invoice_line_items` + `inventory_movements` |
| 011 | `inventory_movements.reserved_delta` + reservation reason codes |
| 012 | `inventory.product_id` CASCADE; `deal_requests.product_id` SET NULL |
| 013 | `shipment_tracking_events` + idempotent unique index |

Apply:
```powershell
pnpm db:migrate
pnpm db:rollback   # reverts the most recent
```

---

## Security posture

| Area | What's enforced |
|------|-----------------|
| Password storage | bcrypt cost 12 |
| Refresh tokens | httpOnly Secure SameSite=Lax cookie, SHA-256 hashed in DB, reuse detection revokes session |
| Access tokens | JWT HS256, in memory only — never in storage or cookies |
| 2FA | TOTP + 10 single-use recovery codes |
| Login | 5/min per IP, 10 failed attempts → 15-min lock |
| Integration secrets | AES-256-GCM encrypted at rest, decrypt key in env only |
| Money math | Decimal only. `NUMERIC(20,8)` on every monetary column. No JS float anywhere in pricing/invoicing/inventory |
| Oversell | `SELECT ... FOR UPDATE` on inventory row inside the status-change transaction |
| Invoice history | Every line item snapshots every calculation input; invoices reprint identically after product hard-delete |
| Audit trail | `audit_logs` for every status change, override, portal enable/disable, password reset, integration change; `inventory_movements` for every on_hand / reserved change |
| Pre-commit | `.githooks/pre-commit` greps staged diffs for credential shapes (AWS, GitHub, Slack, Stripe, Twilio, JWT, PEM) |

---

## Deployment

Two supported paths — pick one host for the API. Frontend stays on Vercel either way.

### Option A — Railway (recommended)

`railway.json` at the repo root tells Railway to build from `apps/api/Dockerfile` with the repo as the build context, health-check `/api/v1/health`, and restart on failure.

1. Push to GitHub.
2. **railway.app → New Project → Deploy from GitHub repo → pick `AGCstore/agc-crm`.**
3. In that project:
   - **+ New → Database → PostgreSQL.** Railway auto-injects `DATABASE_URL`.
   - **+ New → Database → Redis.** Auto-injects `REDIS_URL`.
4. On the API service → **Variables**, paste these (values from your local `.env` or fresh):
   ```
   NODE_ENV=production
   PORT=4000
   API_BASE_URL=https://<the-railway-public-url>
   WEB_ORIGIN=https://<your-vercel-app>.vercel.app
   JWT_ACCESS_SECRET=<openssl rand -base64 64>
   JWT_REFRESH_SECRET=<openssl rand -base64 64>
   APP_ENCRYPTION_KEY=<node -e "..." 32-byte base64>
   METALS_API_KEY=<from metals.dev>
   METALS_API_URL=https://api.metals.dev/v1/latest
   ```
   SMTP_* and TWILIO_* stay blank if you want dev-log fallback.
5. **Networking → Generate Domain** on the API service to get the public URL, then fill it into `API_BASE_URL`.
6. Run migrations once: **API service → Settings → Deploy → Pre-deploy command** set to
   ```
   pnpm --filter @agc/api db:migrate
   ```
   (or run it one-off in the service shell, then remove the command).
7. Vercel → Import → root directory `apps/web`. Edit `apps/web/vercel.json` before deploy:
   ```json
   { "rewrites": [{ "source": "/api/:path*", "destination": "https://<railway-url>/api/:path*" }] }
   ```
8. After Vercel deploys, copy its URL back into Railway's `WEB_ORIGIN` — CORS depends on it matching exactly.

### Option B — Render

`render.yaml` is a one-command blueprint that provisions API (Docker) + Postgres 16 + Redis 7 together.

1. Push to GitHub.
2. Render → New → **Blueprint** → point at the repo.
3. Fill the `sync: false` env prompts (`API_BASE_URL`, `WEB_ORIGIN`, `METALS_API_KEY`, `APP_ENCRYPTION_KEY`, `SMTP_*`, `TWILIO_*`).
4. Vercel → Import → root `apps/web` (same as Railway path).
5. Edit `WEB_ORIGIN` in Render to match your real Vercel URL.
6. Run migrations in the Render shell: `pnpm --filter @agc/api db:migrate`.

### Post-deploy (both paths)

- Rotate the seeded admin password at `/admin/settings`, or delete the seed user.
- Enable 2FA on the admin account at `/dashboard/security`.
- Configure each integration at `/admin/integrations`.

---

## License

Proprietary — all rights reserved.
