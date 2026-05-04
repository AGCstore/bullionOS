#!/usr/bin/env bash
# Tenant provisioning helper. Automates the parts of provisioning that
# benefit from automation; the rest (Railway/Vercel project creation,
# DNS) is documented in docs/PROVISIONING.md and stays manual because
# those CLIs prompt interactively.
#
# Usage:
#   ./scripts/provision-tenant.sh acme-coin
#
# What this does:
#   1. Generates fresh JWT_SECRET, APP_ENCRYPTION_KEY, METALS_PROXY_KEY,
#      and a random INVOICE_DELETE_PIN.
#   2. Prints them in an env-file ready format you can paste into the
#      tenant's Railway service.
#   3. Reminds you to add the new METALS_PROXY_KEY to the central
#      metals-proxy's TENANT_KEYS env.
#
# It does NOT:
#   - Create Railway/Vercel projects (do via dashboard or their CLIs).
#   - Run migrations (Railway's pre-deploy command does this).
#   - Seed the first admin (use the prompts at the bottom of the
#     output once the DB is reachable).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <tenant-slug>" >&2
  echo "  e.g. $0 acme-coin" >&2
  exit 2
fi

TENANT="$1"
if [[ ! "$TENANT" =~ ^[a-z0-9-]+$ ]]; then
  echo "tenant-slug must be lowercase letters, digits, and hyphens" >&2
  exit 2
fi

# ── Generate secrets ──────────────────────────────────────────────
# JWT_SECRET: 32 bytes hex (64 chars). Used by jsonwebtoken HS256 — any
# string of sufficient entropy works.
JWT_SECRET=$(openssl rand -hex 32)
# APP_ENCRYPTION_KEY: must be base64 of exactly 32 bytes. The API
# validates this format on boot (zod refine in env.ts) so make sure
# it stays base64 — switching to hex breaks every encrypted blob.
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
# METALS_PROXY_KEY: any random string >= 16 chars. Hex is fine here.
METALS_PROXY_KEY=$(openssl rand -hex 24)
INVOICE_DELETE_PIN=$(printf '%06d' $((RANDOM % 1000000)))

cat <<EOF

# ─── Tenant: $TENANT ───────────────────────────────────────────────
#
# Paste the lines below into Railway → ${TENANT}-api service env.
# DATABASE_URL should be a reference to the linked db service:
#   DATABASE_URL=\${{db.DATABASE_URL}}
#
# WEB_ORIGIN must match the final Vercel domain (set this AFTER you
# add the custom domain in Vercel, then redeploy the api service).

JWT_SECRET=$JWT_SECRET
APP_ENCRYPTION_KEY=$APP_ENCRYPTION_KEY
METALS_PROXY_KEY=$METALS_PROXY_KEY
INVOICE_DELETE_PIN=$INVOICE_DELETE_PIN
TOTP_ISSUER=<set this to the tenant's display name, e.g. "Acme Coin">
WEB_ORIGIN=<set this to the final Vercel URL, e.g. https://desk.acmecoin.com>
API_BASE_URL=<set this to the Railway-generated api URL, e.g. https://acme-api-production-XXXX.up.railway.app>
METALS_PROXY_URL=<your central metals-proxy URL>
SMTP_HOST=<their SMTP>
SMTP_USER=<their SMTP user>
SMTP_PASS=<their SMTP pass>
SMTP_FROM=<e.g. "Acme Coin <reports@acmecoin.com>">

# ─── ACTION REQUIRED ──────────────────────────────────────────────
#
# 1. Add the METALS_PROXY_KEY above to the central metals-proxy's
#    TENANT_KEYS env (comma-separated). Redeploy the proxy.
#
# 2. After the api service comes up healthy, seed the first admin:
#
#    SEED_ADMIN_EMAIL=owner@<tenant-domain> \\
#    SEED_ADMIN_PASSWORD='<12+ chars>' \\
#    SEED_ADMIN_FIRST=<first name> \\
#    SEED_ADMIN_LAST=<last name> \\
#    DATABASE_URL=<railway public proxy url> \\
#      pnpm --filter @agc/api exec tsx src/db/seed-team.ts
#
# 3. Send the customer the onboarding checklist from docs/PROVISIONING.md
#    section 5.
EOF
