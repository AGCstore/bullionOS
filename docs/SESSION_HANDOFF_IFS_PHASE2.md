# IFS Phase 2 — Handoff (post-build)

## TL;DR

Phase 2 wizard shipped. `/admin/shipments/new-label` walks the operator
through IFS Clients' create-label flow (sender → recipient → service →
package/insurance → cost preview → submit). Successful labels get
persisted to `ifs_shipments` and — when the wizard was launched with
`?invoice_id=X` — also to the local `shipments` table so they appear
on the invoice detail page alongside UPS/USPS labels. International,
multi-ship (PR/SR), pickup-scheduling, and email-notification flows
are explicitly out of scope; Hunter does those on ifsclients.com.

## What's in place after this build

### Backend — `apps/api/src/ifs/`
- **`ifs.service.ts`** — added 16 Phase 2 methods (one per IFS endpoint),
  all routed through the existing `callIfs()` transport. New helpers:
  `requireCreds()`, `requireSuccess()`, `compactStrings()`, `toBool()`,
  `toOptions()`, `joinAddr()`, `buildLabelForm()`. In-memory 1h cache
  for `ca_basic_data.php` (#2) so the wizard mount is fast. The
  Phase 1 `runSync()` / `listShipments()` / `mapShipmentRow()` /
  `scheduledSync()` are unchanged.
- **`ifs.controller.ts`** — admin-only routes:
  - `GET /admin/ifs/basic-data` (#2)
  - `GET /admin/ifs/senders` (#3)
  - `POST /admin/ifs/senders/get` (#4)
  - `GET /admin/ifs/recipients?term=…` (#5)
  - `POST /admin/ifs/service-restriction` (#8)
  - `POST /admin/ifs/verify-address` (#9)
  - `POST /admin/ifs/accept-corrected` (#11)
  - `POST /admin/ifs/zone` (#13)
  - `POST /admin/ifs/packaging-restriction` (#14)
  - `POST /admin/ifs/check-weight` (#16)
  - `POST /admin/ifs/check-declare-value` (#17)
  - `POST /admin/ifs/hold-for-pickup` (#19)
  - `POST /admin/ifs/calculate-cost` (#20)
  - `POST /admin/ifs/labels` (#26 — main submit, takes `{invoice_id?, payload}`)
  - `POST /admin/ifs/shipment-details` (#28)
  - `POST /admin/ifs/void` (#31, admin-only)
- **`dto/wizard.dto.ts`** — class-validator DTOs for every wizard
  endpoint. `LabelPayloadDto` covers both #20 and #26 (same shape).
  `pickup_date` is regex-validated as MM-DD-YYYY.
- **`ifs.module.ts`** — now imports `ShipmentsModule` so
  `IfsService.createLabel()` can call `ShipmentsService.create()` to
  link the new label back to its invoice.

### Frontend — `apps/web/src/app/admin/shipments/new-label/page.tsx`
- Single-page wizard, 6 stepped sections rendered as collapsible cards
  with a top stepper bar. Sticky "Back / Next" buttons; each "Next"
  runs the relevant validator before advancing.
- **Sender step**: dropdown of saved senders (#3), auto-selects the
  AGC default by matching `address1.includes('8480 holcomb bridge')`.
  Falls back to IFS's `primary_id`, then to a literal hardcoded
  fallback. Operator can edit any field before continuing.
- **Recipient step**: typeahead search (#5) + free-form. When launched
  with `?invoice_id=X`, pre-fills from the invoice's client (name,
  email, phone, address). On Next runs #9 — if FedEx returns a
  different address, prompts via `window.confirm`; if accepted and
  the recipient came from the address book, fires #11 to persist.
- **Service step**: `service_type`, `packaging_type`, `signature_type1`,
  pickup date, Saturday delivery, residential. On Next: #8 (ZIP/service
  compat) + #13 (zone_id).
- **Package step**: weight, dimensions (only when packaging_type =
  YOUR_PACKAGING), insurance, payment type. On Next: #16 weight check
  (warning + override on dim mismatch) + #17 insurance check (popup
  chain via `window.confirm` for >$75k single-piece) + #20 cost
  preview.
- **Cost step**: renders `final_amount` + `CostDisplayHtmlArray`
  table. "Create label" submits #26.
- **Success step**: tracking number (links to FedEx tracking page),
  IFS shipment id, label PDF / receipt / return label buttons,
  "Create another" (preserves sender), "Done" (back to invoice or
  shipments list), and a Void button (#31) with the loud warning that
  voiding only cancels the IFS Inforsure insurance — the FedEx label
  stays scannable.

### UI hooks
- **`/admin/shipments`** — added "+ New FedEx label · IFS" button next
  to "Refresh from carriers".
- **`/admin/invoices/[id]` ShipmentSection** — added "+ Create FedEx
  label via IFS" link next to "Add another shipment" / "Create
  shipment". Pre-fills via `?invoice_id=...`.

### Persistence on label-create
On a successful #26, `IfsService.createLabel()`:
1. Inserts into `ifs_shipments` with `carrier='FedEx'`,
   `label_status='ACTIVE'`, sender/recipient/cost/declared_value
   fields from the wizard payload, `raw_payload` = full
   `{input, response}` JSON for reparse.
2. If `invoice_id` was passed, calls `ShipmentsService.create()` with
   `carrier='fedex'`, `tracking_number=tracking_no`,
   `weight_lbs=package_weight`, `insurance_amount=declare_value`,
   `notes='Created via IFS · {ifs_shipment_id}'`. That triggers the
   standard client notification + makes the row visible everywhere
   FedEx labels are shown.
3. The invoice-link insert is wrapped in try/catch — if it fails
   (e.g. invoice canceled mid-flow), the IFS label still exists and
   the failure is logged. Operator can manually link via the standard
   "Add shipment" form.

### Reference doc
`docs/IFS_API_REFERENCE.md` — extracted spec for every wizard
endpoint (request fields, response shapes, wizard-step mapping).
Sourced from the Postman collection + the .docx (since the Postman
`response: []` arrays are all empty).

## What's intentionally NOT done

These are direct extensions once the happy path proves out — they
were scoped out per Hunter:

1. **International / customs / AES** — `ProductsID[]`, all `lbp_*`
   fields, `lb_loading_port_*`, `is_allow_diff_international_customs_value`.
   Hunter does international labels on ifsclients.com.
2. **PR/SR multi-ship auto-split** — when #17's popup chain forces a
   split for >$75k multi-piece, the wizard surfaces an error telling
   the operator to use ifsclients.com. The `final_amount_2` /
   `line_items_2` fields ARE rendered in cost preview if IFS returns
   them, so a future fix can wire the second-parcel inputs without
   reshuffling the FE.
3. **FedEx pickup scheduling** (`lb_is_pickup` block) — operators
   schedule pickups separately.
4. **Email-notification block** (`NotificationName1` etc.) — clients
   already get an AGC Desk notification when the local `shipments`
   row is written.
5. **Save-as-draft** — `gen_label_save` is hardcoded to `1`. Wire a
   "Save draft" button + #30 lookup to revive draft mid-flow if needed.
6. **Recipient hydration via #6** — typeahead returns id+name; the
   operator currently fills the address themselves. Adding `getRecipient(id)`
   and pre-filling from #6 is a 30-line addition.
7. **Per-shipment Refresh button on invoice detail** — `viewShipmentDetails`
   (#28) is wired backend-side but not exposed on the UI yet.
   Easy add to `ShipmentSection`.
8. **Re-enable `scheduledSync` cron** — the `@Cron` decorator on
   `IfsService.scheduledSync` is still commented out. Once Phase 2 has
   created enough shipments, flip it on and have the cron iterate
   `ifs_shipments` calling #28 to refresh `fedex_status` /
   `delivered_at`.
9. **Real popup component for #17 popup chain** — currently uses
   `window.confirm` (functional but ugly). A modal component would
   show the multi-line message + buttons more cleanly.

## Operational notes (still relevant)

- **Hunter is the operator** (id `fb56cd44-523d-4ebb-8809-d286f656d7e0`,
  hunter@atlantagoldandcoin.com).
- **Default sender**: "Your ATL Taxidermy / 8480 Holcomb Bridge Rd
  #200 / Alpharetta, GA 30022". The wizard auto-picks this entry from
  IFS's saved senders by address-substring match.
- **Railway deploys auto-run migrations** via `preDeployCommand`. No
  new migrations in this build — Phase 2 reuses `ifs_shipments`
  (036) + `shipments` (002, multi per migration 034).
- **Prod DB public proxy URL**:
  `railway variables --service agc-postgres --kv | grep DATABASE_PUBLIC_URL`.
  Internal hostname only resolves inside Railway.
- **APP_ENCRYPTION_KEY** + **JWT_ACCESS_SECRET** in Railway env (see
  prior handoff for one-off-script auth recipe).

## Suggested test plan

End-to-end smoke from Hunter (or staff):

1. From `/admin/integrations` confirm the IFS card still shows "active"
   and "Test connection" passes.
2. Navigate to `/admin/shipments/new-label` directly (no invoice).
   - Sender dropdown should auto-pick the AGC default.
   - Type a known recipient (search → typeahead).
   - Pick FedEx Ground / FedEx Envelope, today's date.
   - Weight 1 lb, insurance $0.
   - Cost preview should populate.
   - Submit; success screen shows tracking + label PDF link.
   - Click "Void"; should succeed with the warning modal.
3. From a finalized invoice's detail page, click "+ Create FedEx label
   via IFS" — should land on the wizard with recipient pre-filled.
   Submit; verify the new shipment appears in the invoice's Shipments
   section with `carrier='FEDEX'` and the tracking number.
4. Negative tests:
   - Submit with an invalid ZIP / international country → IFS error
     surfaced as a 400 with the message in the wizard.
   - Insurance > $75k → first/second popup chain renders.

## Most-recent commits (context)

```
[next] feat(ifs): Phase 2 — create-label wizard
       (16 service methods, controller routes, DTOs, /admin/shipments/new-label
        wizard page, invoice + standalone entry points)
[prior] cleanup IFS Phase 1 + handoff
520ee63 feat(ifs): Phase 1 — mirror ifsclients.com shipment dashboard
70cae43 feat(invoices): unit-spacing-agnostic fuzzy product search
…
```
