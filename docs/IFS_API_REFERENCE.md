# IFS Clients shipping API — create-label wizard reference

Sources:
- Request side: `E:/Coin Photos - iStock/IFS Client App v2.1 O.postman_collection`
- Response shapes: `E:/Coin Photos - iStock/10162 - IFS Client API Documentation v2.2 - Atlanta Gold and Coin.docx`

**Base URL:** `https://www.ifsclients.com/client-app-api/`
**Transport:** `POST` `application/x-www-form-urlencoded` (some endpoints in the Postman collection say `multipart/form-data`; treat both as form-data).
**Auth:** every endpoint silently expects `AppUserName`, `AppPassword`, `account_id`. Our `IfsService.callIfs()` already attaches these — the field tables below omit them.
**Common envelope:** every response carries `status` (`"1"` = success, `"0"` = error), `IsLogout` (`"1"` → log user out and force re-auth), and `message` (often a human-readable string).

---

## #3 — `ca_client_address_list.php`
List saved sender ("My Addresses") records.

**Required:** none beyond auth.
**Optional:** none.

**Response**
```json
{
  "status": "1", "IsLogout": "0", "message": "success",
  "client_address": [
    { "id": "", "text": "", "name": "", "company_name": "",
      "address1": "", "is_residential": "0", "is_primaric": "0" }
  ],
  "primaric_client_address_id": ""
}
```
- `id` is what you pass to #4.
- `is_primaric` flags the default sender (also returned at top level as `primaric_client_address_id`).
- `text` is a display label suitable for a `<select>`.

**Wizard step:** Sender — populate the dropdown on first load. Auto-select `primaric_client_address_id`.

---

## #4 — `ca_client_address_data.php`
Fetch full data for one saved sender.

**Required:** `client_address_id` (int).
**Optional:** none.

**Response**
```json
{
  "status": "1", "IsLogout": "0", "message": "success",
  "client_address_data": {
    "company_name": "", "name": "", "address1": "", "address2": "",
    "city": "", "state": "", "zip": "", "country": "",
    "phone": "", "fax": "", "email": "",
    "is_residential": "0", "is_primaric": "0",
    "IsAddressRestricted": "No", "AddressRestrictedMsg": "",
    "GotOIncomeLabelForResidential": 1,
    "GotOIncomeLabelForResidentialMessage": "Residential sender address must proceed by creating Incoming QR Code Label.",
    "VerifyGetCustomerDataToChkResidential": 0
  }
}
```
- `IsAddressRestricted = "Yes"` → block wizard, surface `AddressRestrictedMsg`.
- `GotOIncomeLabelForResidential = 1` → residential sender; redirect to QR / incoming-label flow.

**Wizard step:** Sender — hydrate sender block once user picks an entry.

---

## #5 — `ca_recipient_list.php`
Search recipient address book.

**Required:** none.
**Optional:** `term` (string) — search term against the recipient's "Company (Not Appear)" field.

**Response**
```json
{ "status": "1", "IsLogout": "0", "message": "success",
  "recipient_list": [ { "id": "", "name": "" } ] }
```
- `id` feeds #6 (`ca_recipient_data.php`) for full hydration.

**Wizard step:** Recipient — typeahead search.

---

## #8 — `ca_change_zipcode_service.php`
Domestic shipping restriction check; re-call when `service_type` or `client_zip` changes.

| Param | Type | Notes |
|---|---|---|
| `ca_country` | string | Sender country |
| `client_country` | string | Recipient country |
| `service_type` | string | Carrier service (e.g. `FedEx`) |
| `client_zip` | string/int | Recipient ZIP |

**Response**
```json
{ "status": "1", "IsLogout": "0", "message": "Allow", "is_restricted": "No" }
```
- `is_restricted = "Yes"` → show `message`, block progression.

**Wizard step:** Service — fired on ZIP/service change.

---

## #9 — `ca_verify_recipient_address.php`
FedEx address verification. Returns FedEx's normalized address; UI compares to user input and offers to accept.

**Required:** `client_address1`, `client_country`, `client_zip`.
**Optional:** `recipient_id`, `client_company_name`, `client_address2`, `client_city`, `client_state`.

**Response**
```json
{
  "status": "1", "IsLogout": "0", "message": "success",
  "address_data": {
    "company_name": "", "address": "", "address2": "",
    "city": "", "state": "", "zip": "", "country": "",
    "address_type": "", "residential_address_status": 0
  },
  "selected_address_data": { "address_type": "" }
}
```
- `residential_address_status = 1` → residential; force user to pick signature option.
- `address_data.*` is FedEx-corrected. Show diff vs. user input.
- See also #10 `ca_verify_recipient_address_status.php` — cheaper re-check returning just `{residential_address_status, residential_signature_msg}`.

**Wizard step:** Recipient — runs after recipient form submit, before Service.

---

## #11 — `ca_update_recipient_address.php`
Persist the FedEx-corrected address chosen by operator from #9.

**Required:** `recipient_id`, `FAAddress`, `FACity`, `FAState`, `FAZip`, `FACountry`.
**Optional:** `FACompanyName`, `FAAddress2`, `FAResidentialStatus`.

**Response**
```json
{ "status": "1", "IsLogout": "0", "message": "Address is Verified." }
```

**Wizard step:** Recipient — only if user clicks "Use FedEx-corrected address".

---

## #13 — `ca_get_zone_id.php`
Compute FedEx zone for the lane. Required input to #20 + #26.

**Required:** `recipient_zip`, `recipient_country`, `shipper_zip`, `shipper_country`, `service_type`.
**Optional (but improves accuracy):** `recipient_address`, `recipient_city`, `recipient_state`, `shipper_address`, `shipper_city`, `shipper_state`.

**Response**
```json
{ "status": "1", "IsLogout": "0", "message": "success",
  "zone_status": "", "zone_id": 0, "zone_name": "" }
```

**Wizard step:** Service — once sender/recipient/service chosen, before cost preview.

---

## #14 — `ca_restrict_service_type_from_package_type.php`
Tells UI which `service_type` options to show/hide given chosen `packaging_type`.

**Required:** `packaging_type`.

**Response**
```json
{ "status": "1", "IsLogout": "0", "message": "success",
  "remove_service_type": [],
  "add_service_type": [ { "id": "FEDEX_GROUND", "text": "Ground" } ] }
```

**Wizard step:** Service / Package — fired when packaging changes.

---

## #16 — `ca_check_package_weight.php`
Validates actual weight is not below dimensional weight.

**Required:** `packaging_type`, `service_type`, `package_weight` (lb int).
**Optional (required when `packaging_type = YOUR_PACKAGING`):** `packaging_dim_length`, `packaging_dim_width`, `packaging_dim_height` (in int).

**Response**
```json
{ "status": "1", "IsLogout": "0",
  "message": "Actual Weight should not be less then dimension Weight which is 14.",
  "package_weight_notification": "Yes" }
```
- `package_weight_notification = "Yes"` → show warning.

**Wizard step:** Weight — on weight blur/change.

---

## #17 — `ca_check_declare_value.php`
Insurance value validation. Drives a multi-popup decision tree.

**Required:** `service_type`, `ca_country`, `client_country`.
**Optional (always send):** `declare_value` (int).

**Response (abridged)**
```json
{
  "status": "0", "IsLogout": "0", "message": "success",
  "display_declare_value_related_message_status": "No",
  "display_declare_value_related_popup_status": "Yes",
  "display_declare_value_related_first_popup":   { "message": ["Is this a single piece item?"], "button_lbl": ["Yes","No"] },
  "display_declare_value_related_second_popup":  { "message": ["..."], "button_lbl": ["PROCEED AS SINGLE ITEM","SHIPMENT IS MULTIPLE ITEMS"] },
  "display_declare_value_related_third_popup":   { "message": ["..."], "button_lbl": ["EDIT INSURANCE VALUE TO PROCEED..."] },
  "display_declare_value_related_multiitems_popup": { "message": ["..."], "button_lbl": ["Ok","Cancel"] }
}
```
- `display_declare_value_related_message_status = "Yes"` → out of bounds; show `message`, force fix.
- `display_declare_value_related_popup_status = "Yes"` → value > $75k; run popup chain:
  - First: "Is this a single piece item?" Yes/No.
  - Yes → second: "PROCEED AS SINGLE ITEM" or "SHIPMENT IS MULTIPLE ITEMS".
    - Multiple → third: forces split into PR/SR labels (#26.5 multi-ship variant).
  - No → third directly.

**Wizard step:** Cost / Service — before showing cost preview.

---

## #19 — `ca_get_hold_for_pickup_location.php`
List nearby FedEx Hold-at-Location facilities.

**Required:** `shipping_zip`, `service_type`.
**Optional (recommended):** `shipping_address`, `shipping_city`, `shipping_state`, `shipping_country`.

**Response**
```json
{ "status": "1", "IsLogout": "0", "message": "success",
  "hold_for_location_array": [
    { "PersonName": "", "Email": "", "PhoneNumber": "", "Address": "",
      "City": "", "State": "", "StateOrProvinceCode": "", "PostalCode": "",
      "CountryCode": "", "LocationInProperty": "", "Distance": "",
      "DisplayDistance": "", "MapUrl": "", "locationId": "" }
  ] }
```
- Selected entry's array index → `hal_selected_value` on #26.
- Field mapping into #26:
  - `PersonName` → `hal_company_name`
  - `Address` → `hal_address`
  - `City` → `hal_city`
  - `StateOrProvinceCode` → `hal_state_id`
  - `PostalCode` → `hal_zip`
  - `CountryCode` → `hal_country`
  - `LocationInProperty` → `hal_location_property`
  - plus `hal_distance`, `hal_map_url`.

**Wizard step:** Service — only when "Hold at Location" toggled on.

---

## #20 — `ca_calculate_cost.php`
Cost preview before final submit. ~50 fields — most match #26.

**Required:** `zone_id` (int, from #13).
**"Send-everything-you-have" fields** — same groups as #26:

| Group | Fields |
|---|---|
| Recipient | `recipient_id`, `client_label_name`, `client_company_name`, `client_name`, `client_address1`, `client_zip`, `client_city`, `client_state`, `client_state_id`, `client_country` |
| Sender | `ca_address1`, `ca_city`, `ca_zip`, `ca_country`, `ca_state`, `ca_state_id` |
| Service | `service_type`, `signature_type1`, `saturday_delivery` (0/1), `residential` (0/1, from #9) |
| Package | `packaging_type`, `package_weight`, `package_weight_other` (`"other"` if `packaging_type = YOUR_PACKAGING`), `packaging_dim_length`/`width`/`height` |
| Schedule | `pickup_date` (`MM-DD-YYYY`) |
| Billing | `payment_type`, `account_number` (when `payment_type != SENDER`), `declare_value` |
| HAL | `hold_for_pu` (0/1), `hal_contact_person`, `hal_company_name`, `hal_address`, `hal_city`, `hal_state_id`, `hal_zip`, `hal_phone` (all from #19) |
| International | `lb_duties_taxes_paid_by`, `lb_duties_taxes_acc_no`, `ProductsID`, `lbp_product1`, `lbp_hts_number1`, `lbp_description1`, `lbp_weight_unit1`, `lbp_qty1`, `lbp_origin_of_goods_code1`, `lbp_goods_value1`, `lbp_gross_weight1`, `lbp_license_value1` |

**Response**
```json
{
  "status": "1", "IsLogout": "0", "message": "success",
  "final_amount": 0.00,
  "CostDisplayHtmlArray": [
    { "title": "", "display_value": "", "message_type": "" }
  ],
  "final_amount2": null,
  "CostDisplayHtmlArray2": null
}
```
- `final_amount` → cost preview headline.
- `CostDisplayHtmlArray[]` → render as 2-col table (`title` left, `display_value` right; `message_type` for styling).
- `final_amount2` / `CostDisplayHtmlArray2` populate when #17 forced a PR/SR split.

**Wizard step:** Cost — final review before submit.

---

## #26 — `ca_create_label.php` (the big one)
Submits the shipment, returns `tracking_no` + label PDF URLs.

### Sender block (all required)

| Field | Notes |
|---|---|
| `ca_company_name` | Sender Company Name (Will Not Appear on Label) |
| `ca_name` | Sender Company Name (the one that prints) |
| `ca_label_name` | Sender Contact Name |
| `ca_email` | |
| `ca_address1` | |
| `ca_address2` | optional |
| `ca_city` | |
| `ca_zip` | |
| `ca_state` | Free-text when country ≠ US |
| `ca_state_id` | State picker value when country = US |
| `ca_country` | |
| `ca_phone` | |
| `ca_fax` | optional |

### Recipient block

| Field | Notes |
|---|---|
| `recipient_id` | Optional — only when reusing saved recipient |
| `client_label_name` | Recipient Contact Name **(req)** |
| `client_company_name` | "Company (Not Appear)" **(req)** |
| `client_name` | Company Name (prints on label) **(req)** |
| `client_address1` | **(req)** |
| `client_address2` | optional |
| `client_city`, `client_state`, `client_state_id`, `client_zip`, `client_country` | All **req** |
| `client_phone` | **(req)** |
| `client_email` | Required when `hold_for_pu = 1` |
| `client_is_address_verify` | 0/1 — set 1 if user accepted FedEx verification |
| `residential` | 0/1 — from #9/#10 |

### Package block

| Field | Notes |
|---|---|
| `packaging_type` | enum **(req)** |
| `package_weight` | int (lb) **(req)** |
| `packaging_dim_length` / `_width` / `_height` | int (in) — required when `packaging_type = YOUR_PACKAGING` |

### Service block

| Field | Notes |
|---|---|
| `service_type` | enum **(req)** |
| `zone_id` | int **(req)** — from #13 |
| `signature_type1` | e.g. `Direct Signature`, `No Signature Required` |
| `saturday_delivery` | 0/1 **(req)** |
| `pickup_date` | `MM-DD-YYYY` **(req)** |
| `declare_value` | int — insurance, no decimals **(req)** |

### Hold-at-Location block (only when `hold_for_pu = 1`)

| Field | Notes |
|---|---|
| `hold_for_pu` | 0/1 |
| `hal_selected_value` | Index into #19 array |
| `hal_company_name`, `hal_address`, `hal_city`, `hal_state`, `hal_state_id`, `hal_zip`, `hal_country` | from #19 |
| `hal_phone`, `hal_contact_person` | recipient phone/contact |
| `hal_location_property`, `hal_map_url`, `hal_distance` | from #19 |
| `hal_email` | optional, from #19 |

### Billing block

| Field | Notes |
|---|---|
| `payment_type` | `SENDER` / `RECIPIENT` / `THIRD_PARTY` (req) |
| `account_number` | Required when `payment_type != SENDER` |
| `cost` | from #20 `final_amount` |

### References / label output

| Field | Notes |
|---|---|
| `reference` | Personal reference (≤25 chars per docs, ≤40 per Postman) |
| `reference_show_on_label` | 0/1 |
| `label_stock_type` | e.g. `PAPER_8.5X11_BOTTOM_HALF_LABEL` (req) |
| `gen_label_save` | `1` = generate now, `0` = save as draft |
| `display_receipt` | 0/1 — open receipt PDF in new tab |

### Email-notification block (optional)

| Field | Notes |
|---|---|
| `NotificationEmailHidden` | array |
| `NotificationName1`, `NotificationEmail1` (and 2, 3...) | one pair per recipient |
| `message` | body — collides with response `message` key, namespace carefully |

### International / AES block (international only)

`ProductsID[]`, `lbp_product1`, `lbp_description1`, `lbp_hts_number1`, `lbp_weight_unit1`, `lbp_qty1`, `lbp_gross_weight1`, `lbp_goods_value1`, `lbp_origin_of_goods_code1`, `lb_duties_taxes_paid_by`, `lb_duties_taxes_acc_no`, `lb_loading_port_code`, `lb_allow_aes`, `lb_aes_amount`, `lb_loading_port_date` (`MM-DD-YYYY`).

### Pickup-scheduling block (optional)

`lb_is_pickup` (0/1), `lb_pickup_location_type`, `lb_pickup_building_part_code`, `lb_pickup_building_part_description`, `lb_pickup_time`, `lb_pickup_courier_remark`.

### PR/SR multi-ship variant (when #17 forced split)

Same payload plus `is_multiship_label=1`, `multiship_total_declare_value`, second-parcel `packaging_type2`/`package_weight2`/`packaging_dim_length2`/`_width2`/`_height2`, `declare_value2`, `reference2`.

### Response
```json
{
  "status": "1", "IsLogout": "0", "message": "Label is Generated.",
  "shipment_id": "",
  "tracking_no": "",
  "view_label_link": "",
  "view_return_label_link": "",
  "view_commercial_invoice_link": "",
  "view_receipt": ""
}
```
- `shipment_id` — IFS internal ID; persist this. Used by #28/#31.
- `tracking_no` — FedEx tracking number.
- Multi-ship response also has `status2`, `message2`, second `tracking_no2`/`view_label_link2`/etc.
- If response has `different_international_customs_value = "Yes"` (international, declared > customs), show confirmation popup; if user acknowledges, re-call #26 with `is_allow_diff_international_customs_value = 1`.

**Wizard step:** Submit.

---

## #28 — `ca_view_shipment_details.php`
Refresh status / detail for a known shipment.

**Required (one of):** `tracking_no` (string/int) **OR** `shipment_id` (int — takes priority if both sent).

**Response (abridged)** — see docx for full detail. Key fields:
- `package_shipment_info.fedex_status`
- `package_shipment_info.tracking_no`
- `cost_info[]` (array of `{text, value}`)
- `delivery_information.{delivered_to, delivered_date, delivered_signature}`
- `notification_info.{notification_status, exception_status, tendered_status, delivered_status}`

`actual_shipping_info` and `delivery_information` populate specially for masked-address ZIPs (LA 90013/90014 — Inforsure CRA forwarding).

**Wizard step:** Post-create + per-shipment Refresh button on invoice detail.

---

## #31 — `ca_void_shipment.php`
Cancel/void the IFS Inforsure side of a shipment.

**Required:** `shipment_id` (int).

**Response**
```json
{ "status": "1", "IsLogout": "0",
  "message": "Selected shipment status changed to void." }
```
- **Important caveat:** this only voids the **insurance**. The FedEx label remains usable; physically prevent print/handoff. Surface that warning in the void confirmation modal.
- Cannot be reversed. Issue a new label (fresh #26) if needed.

**Wizard step:** Post-submit / shipment history.

---

## Cross-cutting wizard flow

1. **Sender step** — #3 on mount, auto-pick `primaric_client_address_id`, hydrate via #4. Check `IsAddressRestricted` + `GotOIncomeLabelForResidential`.
2. **Recipient step** — #5 typeahead, #6 for hydration. On finish: #9 → diff dialog → #11 if user accepts. Capture `residential_address_status`.
3. **Service step** — #8 on ZIP/service change, #14 on packaging change, #13 once everything settles to get `zone_id`.
4. **Package / Weight step** — #16 on weight/dim change.
5. **Insurance / billing step** — #17 on `declare_value`/`service_type` change → popup decision tree. If HAL toggled: #19.
6. **Cost preview step** — #20 with full assembled payload.
7. **Submit step** — #26 (or multi-ship variant). Persist `shipment_id` + `tracking_no`. Open `view_label_link` / `view_receipt`.
8. **Confirmation** — #28 to verify FedEx status. Offer #31 (void) with prominent warning.

## Notes on what's NOT in the Postman collection

- Every endpoint's `response: []` is empty. All response shapes above came from the .docx (`word/document.xml`).
- Enum values for `service_type`, `packaging_type`, `payment_type`, `signature_type1`, `label_stock_type` come from #2 (`ca_basic_data.php`) — capture #2's full response separately to drive dropdowns.
- `signature_type1` accepts free-text/display strings (e.g. `"Direct Signature"`, `"No Signature Required"`) per Postman example values — verify against #2's basic-data response.
