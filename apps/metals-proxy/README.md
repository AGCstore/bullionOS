# BullionOS Metals Proxy

A small Express service that fronts metals.dev with one shared API key, caches the snapshot in-memory, and serves it to N tenant API deploys via per-tenant Bearer keys.

```
metals.dev  <----  this proxy  <----  tenant1 API
                          ^---------- tenant2 API
                          ^---------- ...
```

## Why

- **One metals.dev call per minute** regardless of tenant count. With 50 tenants polling directly, you'd burn 50× the quota.
- **Per-tenant keys** can be rotated/revoked centrally without redeploying each tenant's stack.
- **Tenants never see the master metals.dev key.**

## Deploy (Railway)

This is meant to live in your central ops account, not in any tenant's project.

1. Create a new Railway service from this repo, point it at `apps/metals-proxy`.
2. Set env:

   | Var | Required | Default | Description |
   | --- | --- | --- | --- |
   | `METALS_API_KEY` | yes | — | Master metals.dev API key |
   | `TENANT_KEYS` | yes | — | Comma-separated Bearer tokens (each ≥16 chars). One per tenant. |
   | `METALS_API_URL` | no | `https://api.metals.dev/v1/latest` | Override if metals.dev moves. |
   | `POLL_INTERVAL_MS` | no | `60000` | How often to refresh from metals.dev. |
   | `PORT` | no | `4001` | Listen port. |

3. Health check: `GET /health` returns `{ ok, cached, cachedAt, consecutiveFailures, tenantKeys }`.

## Per-tenant configuration

Issue a Bearer key per tenant (use a CSPRNG, ≥32 chars). On each tenant's API service, set:

```
METALS_PROXY_URL=https://metals-proxy.example.internal
METALS_PROXY_KEY=<that-tenant's-bearer>
```

The tenant's `MetalsService` automatically prefers the proxy when both env vars are set, and falls back to direct `metals.dev` when either is missing.

## Endpoints

- `GET /health` — liveness, no auth.
- `GET /spot` — returns the cached metals.dev snapshot. Requires `Authorization: Bearer <token>`. Returns `503` until the first successful upstream fetch lands.

## Rotating a tenant's key

1. Generate a new token: `openssl rand -hex 24`.
2. Append it to `TENANT_KEYS` (don't remove the old one yet). Redeploy.
3. Update the affected tenant's `METALS_PROXY_KEY` to the new value. Redeploy that tenant.
4. Once the tenant is on the new key, remove the old token from `TENANT_KEYS`. Redeploy.

This zero-downtime rotation works because `TENANT_KEYS` accepts multiple valid keys at once.
