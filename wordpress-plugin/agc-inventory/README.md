# AGC Inventory

WordPress plugin that renders live AGC Desk inventory and buy prices on
atlantagoldandcoin.com. Two Elementor widgets, two shortcodes, one HTTP
round-trip per minute per WP instance (server-side transient cache).

## Install

1. Zip this directory (`agc-inventory/`).
2. In WP admin → **Plugins → Add New → Upload Plugin** → upload the zip.
3. Activate.
4. Visit **Settings → AGC Inventory** — confirm the API base URL or paste
   a custom one. Leave blank to use the Railway default.

## Use

### Elementor

Two widgets appear under the **AGC Desk** category in the Elementor
editor:

- **AGC Live Inventory** — in-stock items with quantity, grouped by metal.
- **AGC What We Pay** — every catalog item with the live buy price.

Each widget has a **Metal filter** control so you can drop a "Gold only"
widget on the Gold page, a "Silver only" on the Silver page, and so on.
Leave it set to **All metals** and you get all four metals on one page.

### Shortcodes (no Elementor required)

```
[agc_live_inventory]
[agc_live_inventory metal="gold"]

[agc_what_we_pay]
[agc_what_we_pay metal="silver"]
```

## Refresh cadence

- Browser auto-polls every minute between **8 AM – 6 PM US/Eastern**.
- WP transient caches upstream responses for 60 s, so one visitor per
  minute drives one upstream call regardless of traffic.
- Outside business hours the page still renders — it just stops polling
  until the next day.

Want a different cadence? Edit the two constants near the top of
`agc-inventory.php`:

```php
define( 'AGC_INV_CACHE_TTL', 60 );
define( 'AGC_INV_WINDOW_START_HOUR', 8 );
define( 'AGC_INV_WINDOW_END_HOUR', 18 );
```

…and the `refreshMs` in the `wp_localize_script` call right below them.

## Updating when AGC Desk changes

Nothing to do. The WP plugin pulls live from AGC Desk's public
endpoints. Any product edit, inventory adjustment, or pricing rule
change on AGC Desk shows up on the WordPress site within one minute
(or on the next page-load, whichever is sooner).

## Endpoints consumed

- `GET /public/in-stock` — Live Inventory widget
- `GET /public/what-we-pay` — What We Pay widget

Both are public, cached on AGC Desk's side in Redis.

## Local WP development

To test against a local AGC Desk instance (`http://localhost:4000`),
paste `http://localhost:4000/api/v1` into the Settings → API base field.
Make sure your local AGC Desk has the `show_on_website` flag enabled on
a handful of products so there's something to render.
