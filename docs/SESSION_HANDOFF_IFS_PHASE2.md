# IFS Phase 2 — Handoff for next session

## TL;DR

We tried to mirror ifsclients.com's shipment dashboard inside `/admin/shipments` (Phase 1). **The IFS public API has no list endpoint** — every shipment lookup requires a `tracking_no` or `shipment_id` you already know. Phase 1 panel was removed; the Phase 2 plan is to build the create-label wizard so AGC Desk learns each shipment's tracking number at creation time, then enriches with details via `#28 ca_view_shipment_details.php`.

## What's already in place (don't redo)

### Backend infrastructure (commit `520ee63`, hardening in subsequent commit)
- **Migration 036** — `ifs_shipments` cache table (one row per shipment, `raw_payload` jsonb for reparse) + `ifs_sync_state` singleton. Both live in prod.
- **`apps/api/src/ifs/ifs.service.ts`**
  - `callIfs(creds, endpoint, extra)` — single transport helper. POST form-data with `AppUserName` / `AppPassword` / `account_id` on every request, 30s timeout, surfaces non-JSON error bodies. **Reuse this for every IFS endpoint in Phase 2.**
  - `testConnection()` — works against `ca_basic_data.php`. Confirms creds reach IFS cleanly.
  - `runSync()` / `listShipments()` / `getSyncState()` / `mapShipmentRow()` / `extractShipmentArray()` — built but currently dead code (no list endpoint exists). Keep for reference; Phase 2 will likely repurpose `mapShipmentRow` to ingest the `#28` per-shipment response.
  - `scheduledSync()` — `@Cron` decorator commented out so it doesn't fire against a broken URL every 15 min. Re-enable for per-shipment status refresh once Phase 2 has tracking numbers to refresh.
- **`apps/api/src/ifs/ifs.controller.ts`** — exposes admin-only:
  - `GET /admin/ifs/state` (sync metadata)
  - `GET /admin/ifs/shipments?q=…` (currently returns empty since runSync isn't running)
  - `POST /admin/ifs/sync` (currently broken — no list endpoint)
- **Integrations registry** (`integrations.registry.ts`) — `ifs` provider with `app_user_name` / `app_password` / `account_id` / `url`. Test button works.
- **Credentials are saved encrypted in prod** under `integrations.provider='ifs'` — Hunter has already configured them and confirmed the test passed. **Do not ask him to re-enter creds.**

### Frontend (after cleanup commit)
- **`/admin/integrations` IFS card** — fully functional, shows "active" status, Test connection works.
- **`/admin/shipments` IFS panel** — **REMOVED**. Page is back to its pre-IFS state (just the "Linked to invoices" carrier-tracked table).

## What Phase 2 needs to do

### The create-label wizard
Build `/admin/shipments/new-label` (or a modal on the invoice detail page) that walks the operator through IFS's create-label flow. Endpoint #26 (`ca_create_label.php`) takes 80+ fields. The wizard mirrors IFS's own UI:

1. **Sender** — dropdown of saved senders (call `#3 ca_client_address_list.php` → `#4 ca_client_address_data.php` to populate). Default to the first sender.
2. **Recipient** — search saved recipients (`#5 ca_recipient_list.php`) + free-form entry. On entry, run `#9 ca_verify_recipient_address.php` → if FedEx returns a corrected address, prompt operator to accept (`#11 ca_update_recipient_address.php`).
3. **Service + packaging** — `service_type` (FedEx, etc.) + `packaging_type`. Restrictions API: `#8 ca_change_zipcode_service.php` (zip+service combo) + `#14 ca_restrict_service_type_from_package_type.php`. `#13 ca_get_zone_id.php` returns the zone_id needed for create.
4. **Weight + dimensions + insurance** — fields on the form. Validate via `#16 ca_check_package_weight.php` + `#17 ca_check_declare_value.php`.
5. **Cost preview** — `#20 ca_calculate_cost.php` shows the price before commit.
6. **Submit** — POST to `#26 ca_create_label.php` with all 80+ fields. Response includes `tracking_no` + label PDF URL/bytes.
7. **Persist locally** — write a row into `ifs_shipments` (using the existing `mapShipmentRow` shape) AND optionally into the existing `shipments` table tied to an invoice if one was selected at the start of the wizard.

### Tying labels to invoices
The existing `shipments` table (migration 002) already supports multi-shipment per invoice (commit `00784aa`). When the wizard starts from `/admin/invoices/[id]`, default the recipient to the invoice's client + pre-fill the address, and on label-create write a row into `shipments` with the new tracking number. That makes the label appear on the invoice detail page automatically alongside any UPS/USPS/etc labels.

### Other endpoints worth wiring
- `#19 ca_get_hold_for_pickup_location.php` — for "Hold at FedEx location" deliveries
- `#28 ca_view_shipment_details.php` — pull updated tracking + delivery status for a known shipment_id. Use this in a per-shipment "Refresh" button on the invoice detail page. Eventually re-enable the `scheduledSync` cron to refresh all known IFS shipments via this endpoint.
- `#31 ca_void_shipment.php` — cancel a label. Add a "Void" button on the IFS shipment detail row.

## Key files to read before starting Phase 2

- `apps/api/src/ifs/ifs.service.ts` — has the working transport (`callIfs`), the row-mapper (`mapShipmentRow`), and the disabled cron with rationale comments.
- `apps/api/src/integrations/integrations.registry.ts` — IFS provider definition. **Don't add a new provider** — extend this one.
- `E:/Coin Photos - iStock/IFS Client App v2.1 O.postman_collection` — full endpoint catalog with field names + descriptions. The .docx in the same folder has more detail (response shapes, enum values) — extract via PowerShell `Expand-Archive` if needed.
- `apps/api/src/db/migrations/036_ifs_shipments.ts` + `apps/api/src/db/types.ts` (`IfsShipmentsTable`) — local cache shape, already in prod.
- `apps/web/src/app/admin/invoices/[id]/page.tsx` — `ShipmentSection` component shows how shipments are currently rendered + how the multi-shipment-per-invoice flow works. Phase 2's "tie label to invoice" hook plugs in there.

## Decisions already made (don't relitigate)

- **Single transport pattern**: every IFS request goes through `callIfs()` so auth is centralized. Don't sprinkle fetch calls.
- **Snake-case + camelCase tolerance**: `mapShipmentRow` accepts both. IFS isn't consistent.
- **Provider-agnostic integration storage**: creds stay in `integrations` table encrypted. Don't add an `ifs_credentials` table.
- **Backend-side error translation**: surface real Postgres / IFS errors to the admin UI via `BadRequestException` rather than the 500 mask. See `historical-invoices.service.ts` for the pattern.

## Operational notes

- **Hunter is the operator**. He's the admin user with id `fb56cd44-523d-4ebb-8809-d286f656d7e0`. Email: hunter@atlantagoldandcoin.com.
- **Railway deploys auto-run migrations** via `preDeployCommand` (`node dist/db/migrator.js up`). New migrations apply on push.
- **APP_ENCRYPTION_KEY** is in Railway env (32-byte base64). For one-off scripts that need to read encrypted credentials, decrypt with AES-256-GCM: nonce=blob[0:12], tag=blob[-16:], ct=blob[12:-16].
- **Prod DB**: pull the public proxy URL from Railway with `railway variables --service agc-postgres --kv | grep DATABASE_PUBLIC_URL`. The internal hostname `agc-postgres.railway.internal` is only resolvable from inside Railway containers, so local scripts need the public proxy URL.
- **JWT_ACCESS_SECRET**: in Railway env. For local script auth against prod API, mint with `expiresIn: '15m'` matching the `AccessTokenPayload` shape `{sub, email, role, typ:'access'}`.

## What to ask Hunter at session start

1. Did IFS support reply about an undocumented list endpoint? (He said he'd email them.) If yes, we can revive Phase 1 quickly. If no or no reply, proceed with Phase 2.
2. Should the Phase 2 wizard live as a standalone `/admin/shipments/new-label` page, or a modal on the invoice detail page (or both)? Default: both — the modal is the common path (creating a label for an invoice we just made), the standalone page handles the rare "ship something not tied to an invoice" case.
3. What's AGC's default sender? The wizard should pre-fill it. Likely the first entry returned by `#3 ca_client_address_list.php`.

## Most-recent commits (context)

```
[next] cleanup IFS Phase 1 + handoff
520ee63 feat(ifs): Phase 1 — mirror ifsclients.com shipment dashboard
70cae43 feat(invoices): unit-spacing-agnostic fuzzy product search
32a89bf feat(invoices): payment-method filter on the list page
4b7ac0c fix(clients): show 'Re-enable portal' button for disabled-but-linked accounts
351e1ab fix(clients): re-enable portal access works after disable
ba48d8f feat(clients): auto-fill client record from ID OCR (blank fields only)
efff95f fix(invoices): getById 500 — users table has no first_name column
1b457e7 feat(invoices): show Created By on invoice detail + PDF
6babf97 chore(eod-reports): shift cron from 18:00 to 17:00 ET
0bb5a07 feat(eod-reports): merge app_settings extra_recipients into send list
29965a6 feat(eod-reports): daily 5pm Mon-Fri summary email
```
