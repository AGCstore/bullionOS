# AGC CRM + Trading + Client Portal

Production-grade CRM, trading desk, inventory, and secure client portal.

> **Status: Phase 0 — Foundation.** Auth, DB schema, and base UI are complete and runnable. Trading/invoice/pricing/shipments modules land in Phase 1+.

---

## Stack

| Layer      | Choice                                                          |
|------------|-----------------------------------------------------------------|
| Monorepo   | pnpm workspaces                                                  |
| Backend    | NestJS 10 + Kysely + PostgreSQL 16 + Redis 7                     |
| Auth       | JWT (HS256) access + rotating refresh tokens + bcrypt (cost 12)  |
| Frontend   | Next.js 15 (App Router) + React 19 + Tailwind + TanStack Query   |
| Money      | `NUMERIC(20,8)` on all monetary columns                          |
| Containers | Docker Compose (Postgres + Redis)                                |

---

## One-time setup

### 1. Install prerequisites

- **Node.js 20.11+** — https://nodejs.org (LTS)
- **pnpm 9+** — `npm install -g pnpm`
- **Docker Desktop** — https://www.docker.com/products/docker-desktop (needed for Postgres + Redis)
- **Git** — https://git-scm.com

Verify:

```bash
node -v     # should be >= 20.11
pnpm -v     # should be >= 9
docker -v
```

### 2. Clone / open the project

```bash
cd /e/agc-crm        # or E:\agc-crm on Windows
```

### 3. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Then edit `apps/api/.env` and replace the two JWT secrets with strong random values:

```bash
# Generates a 64-byte base64 secret; run it twice and paste into .env
openssl rand -base64 64
```

Set:
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

> On Windows without OpenSSL, use PowerShell:
> `[Convert]::ToBase64String((1..64 | % { [byte](Get-Random -Max 256) }))`

The `METALS_API_KEY` is already pre-filled from metals.dev.

### 4. Install dependencies

```bash
pnpm install
```

### 5. Start Postgres + Redis

```bash
pnpm db:up
```

Wait a few seconds, then:

```bash
pnpm db:migrate
pnpm db:seed
```

The seed creates a default admin:
- Email: `admin@agc.local`
- Password: `ChangeMe_Admin_123!`

> **Rotate this password immediately** for any non-local use (log in then change, or delete the user and create a fresh one).

### 6. Run the dev servers

In one terminal:

```bash
pnpm api:dev
```

In another:

```bash
pnpm web:dev
```

- API:  http://localhost:4000/api/v1/health
- Web:  http://localhost:3001

> Web runs on **3001** (not 3000) to avoid conflict with Open WebUI / other common dev containers.

Register a new client at `/register`, or sign in with the admin seed credentials at `/login`.

---

## Project structure

```
agc-crm/
├── apps/
│   ├── api/                     # NestJS backend
│   │   └── src/
│   │       ├── auth/            # register, login, refresh, logout, /me
│   │       ├── common/          # guards, decorators, filters
│   │       ├── config/          # env schema (zod)
│   │       ├── db/              # Kysely + migrations + seed
│   │       ├── health/
│   │       ├── app.module.ts
│   │       └── main.ts
│   └── web/                     # Next.js 15 portal (client + admin shell)
│       └── src/
│           ├── app/
│           │   ├── login/
│           │   ├── register/
│           │   └── dashboard/
│           └── lib/             # api client, auth context
├── packages/
│   └── shared/                  # shared zod schemas + types
├── docker-compose.yml
└── README.md
```

---

## API reference (Phase 0)

All routes are prefixed with `/api/v1`.

| Method | Path              | Auth     | Purpose                          |
|--------|-------------------|----------|----------------------------------|
| GET    | `/health`         | public   | Health + DB ping                 |
| POST   | `/auth/register`  | public   | Self-signup (role: client)       |
| POST   | `/auth/login`     | public   | Issue access + refresh tokens    |
| POST   | `/auth/refresh`   | public   | Rotate refresh token             |
| POST   | `/auth/logout`    | public   | Revoke a refresh token           |
| GET    | `/auth/me`        | bearer   | Current user profile             |

Upcoming (Phase 1+): `/admin/*`, `/client/*`, `/public/*`, `/shipping/*`, WebSocket namespace `/ws`.

---

## Security posture (what's already enforced)

- **Password storage:** bcrypt cost 12 (configurable).
- **Account lockout:** 10 failed logins → 15-minute lock (per-user).
- **Timing-safe login:** dummy bcrypt compare on unknown email to prevent enumeration.
- **JWT algorithm pinning:** `HS256` only; no `alg: none` accepted.
- **Refresh token rotation:** every `/auth/refresh` issues new tokens; old one is revoked.
- **Reuse detection:** presenting an already-revoked refresh token revokes ALL sessions for that user.
- **Hashed storage:** refresh tokens are stored as SHA-256; raw tokens never in DB.
- **Rate limiting:** global 100/min; auth endpoints 5/min.
- **Input validation:** `class-validator` + whitelist + `forbidNonWhitelisted`.
- **Helmet** headers on all API responses.
- **CORS** locked to `WEB_ORIGIN`.
- **Log redaction:** pino scrubs `authorization`, `cookie`, `password`, `refresh_token`, `totp`.
- **SQL injection:** Kysely parameterized queries only; no string interpolation into SQL.
- **XSS:** React escapes by default; no `dangerouslySetInnerHTML`.
- **Audit log:** every login and registration persisted to `audit_logs`.

### What's stubbed / explicitly pending

- **2FA**: DB column + login branch exist; TOTP verify is a placeholder. Wire `otplib` + QR in Phase 3.
- **Refresh tokens in httpOnly cookies**: currently in `sessionStorage` for Phase 0. Move to httpOnly+Secure+SameSite=Lax cookies when we add the CSRF double-submit token.
- **Email/SMS notifications**: SMTP config in env; provider not wired yet.

---

## Common commands

```bash
# Monorepo
pnpm install                 # install everything
pnpm dev                     # run all apps in parallel
pnpm build                   # build all apps

# Database
pnpm db:up                   # start Postgres + Redis
pnpm db:down                 # stop them
pnpm db:logs                 # tail postgres logs
pnpm db:migrate              # apply pending migrations
pnpm db:rollback             # revert last migration
pnpm db:seed                 # seed admin + sample client

# Per-app
pnpm api:dev                 # NestJS hot-reload
pnpm web:dev                 # Next.js hot-reload
```

---

## Adding a migration

```bash
# 1. Create apps/api/src/db/migrations/00N_whatever.ts
#    (copy the shape of 001_init.ts)
# 2. Apply:
pnpm db:migrate
```

Migrations are ordered by filename. Never edit a migration that has been applied in production — always add a new one.

---

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:5432`** — Postgres isn't up. Run `pnpm db:up` and wait ~5s.

**`JWT_ACCESS_SECRET must be >= 32 chars`** — you didn't replace the `.env` placeholders. Generate secrets with `openssl rand -base64 64`.

**`port 3000 already in use`** — another dev server is running. Kill it or change `apps/web`'s port.

**Windows line endings in shell scripts** — use Git Bash or WSL. The project itself uses LF.

---

## Deployment

Recommended stack:

| Layer    | Provider                   |
|----------|----------------------------|
| Frontend | Vercel                     |
| Backend  | Render (Docker)            |
| DB       | Render Postgres            |
| Cache    | Render Redis               |
| Edge     | Cloudflare (optional WAF + TLS)     |

Everything the pipeline needs ships in the repo:
- `apps/api/Dockerfile` — multi-stage build (~120 MB final image, runs as non-root, tini as PID 1)
- `render.yaml` — one-command Render blueprint; provisions the web service + Postgres + Redis with pre-wired env var links
- `apps/web/vercel.json` — Next.js config with `/api/*` rewrite to the Render URL
- `.github/workflows/ci.yml` — lint + typecheck + migrations + build on every PR

### First deploy (≈10 minutes)

**1. Backend on Render**

Edit `render.yaml`, replace `CHANGE_ME/agc-crm` with your GitHub repo slug, then:

```bash
git push origin main
# In Render dashboard: New → Blueprint → point at your repo
```

Render will prompt for the `sync: false` secrets:
- `API_BASE_URL` → `https://agc-api.onrender.com` (Render fills this after creation)
- `WEB_ORIGIN` → `https://<your-vercel-app>.vercel.app`
- `METALS_API_KEY` → your metals.dev key
- `SMTP_*` → optional; if blank the API uses a dev log transport
- `TWILIO_*` → optional; same pattern

`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are auto-generated by Render.
`DATABASE_URL` and `REDIS_URL` are wired automatically to the managed services.

After the service comes up:

```bash
# In the Render shell for agc-api:
pnpm --filter @agc/api db:migrate
pnpm --filter @agc/api db:seed          # creates initial admin
pnpm --filter @agc/api db:seed:trading  # seeds the product catalog + pricing rules
```

(Or set these as a "pre-deploy command" in Render so future pushes run migrations automatically.)

**2. Frontend on Vercel**

Edit `apps/web/vercel.json`, replace the `CHANGE_ME.onrender.com` host with your Render URL. Then in Vercel:

```
Import GitHub repo → Root directory: apps/web → Deploy
```

No env vars required on Vercel — the `/api/*` rewrite talks to Render directly. If you prefer direct API calls from the browser (no rewrite), set `NEXT_PUBLIC_API_URL` and remove the rewrite.

**3. Point WEB_ORIGIN at the real Vercel URL**

Back in Render, update `WEB_ORIGIN` to your Vercel production URL. This is what CORS checks against — if you skip this, the browser will block the web → API requests.

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every push/PR:
- `pnpm install` (cached via pnpm-setup action)
- typecheck API + web (`tsc --noEmit`)
- Apply all migrations against a throwaway Postgres 16 service container
- Build API + web

If any step fails, the PR is blocked.

### Running migrations on deploy

The Render blueprint does NOT run migrations automatically on every deploy. Two recommended options:

- **Manual (safe default):** SSH into the Render shell, `pnpm db:migrate`
- **Auto:** add `pnpm --filter @agc/api db:migrate` as the "pre-deploy command" on the web service in the Render UI. Make sure your CI has already validated the migration.

### Production security checklist

- [ ] `NODE_ENV=production` set — this flips the refresh cookie to `Secure` (HTTPS-only)
- [ ] `WEB_ORIGIN` matches your real frontend URL (CORS enforcement)
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are unique to this environment (do not reuse dev secrets)
- [ ] Postgres behind the Render private network (default)
- [ ] Redis behind the Render private network (`ipAllowList: []` in `render.yaml`)
- [ ] Cloudflare (or equivalent) in front for TLS + WAF + DDoS
- [ ] Cycle the seed admin password: log in, visit Settings, reset
- [ ] Enable 2FA on the admin account (Dashboard → Security)
- [ ] SMTP credentials set so notification emails actually send
- [ ] Consider separate domains for API and web (CORS tightens, cookies get a stricter `Domain`)

---

## Roadmap

- **Phase 1 — Core trading** ✅
  Products, pricing engine, invoices, PDFs, metals.dev live feed.
- **Phase 2 — Client portal** ✅
  Transaction history, what-we-pay, deal requests, shipments, SSE price stream.
- **Phase 3 — Integrations & hardening** ✅
  TOTP 2FA, price lock-in quotes, photo uploads, email via SMTP, full client CRM, fuzzy search, inventory tied to invoices, in-stock dashboards.
- **Phase 4 — Production-ready** ✅
  httpOnly refresh cookies, staff↔client messaging, SMS via Twilio, Dockerfile, CI, Render + Vercel deploy configs.
- **Phase 5 — External integrations (needs keys)**
  UPS/FedEx/USPS tracking API polling (webhook + pull), DocuSign for sell-side contracts, bank ACH rails via Plaid/Dwolla, recurring buyer programs, mobile app (React Native over `@agc/shared`).

---

## License

Proprietary — all rights reserved.
