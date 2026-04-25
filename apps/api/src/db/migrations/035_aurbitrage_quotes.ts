import { Kysely, sql } from 'kysely';

/**
 * 035_aurbitrage_quotes
 *
 * Aurbitrage (aurbitrage.com) is a wholesaler-pricing aggregator —
 * they continually scrape buy/sell prices from MTB Metals, Dillon Gage,
 * Pinehurst, APMEX, Sunshine Mint, etc., and expose a unified API that
 * lets dealers like AGC instantly compare who's offering the best
 * price on a given product. Their `/api/v1/pricing/favorites` endpoint
 * returns the operator's curated favorites list with per-dealer
 * bid/ask rows.
 *
 * Schema:
 *   - `aurbitrage_quotes` is a flat table — one row per (sku, side,
 *     dealer) tuple. Sync runs wipe + reinsert the whole set in a
 *     transaction, since the API returns the full favorites payload
 *     each call. Saves us from compound-uniqueness gymnastics on
 *     dealers/sides for the same product.
 *   - `aurbitrage_sync_state` is a singleton row tracking the last
 *     successful sync timestamp + a brief status message. UI reads it
 *     to render "synced 3m ago" badges and to show errors when a
 *     sync fails.
 *
 * Indexes are on (aurbitrage_sku_id) for the per-product lookup the
 * compare view will eventually use, and on (metal) for the gold/silver
 * category filter on the browse page.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('aurbitrage_quotes')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // Identity / classification (from Aurbitrage's response)
    .addColumn('aurbitrage_sku_id', 'integer', (c) => c.notNull())
    .addColumn('product_name', 'text', (c) => c.notNull())
    .addColumn('category', 'text')
    .addColumn('sub_category', 'text')
    .addColumn('product_type', 'text')
    .addColumn('metal', 'text')
    .addColumn('equivalent_oz', sql`numeric(20, 8)`)
    // The quote
    .addColumn('side', 'text', (c) => c.notNull().check(sql`side in ('bid', 'ask')`))
    .addColumn('dealer', 'text', (c) => c.notNull())
    .addColumn('dealer_id', 'integer')
    .addColumn('price', sql`numeric(20, 6)`, (c) => c.notNull())
    // 'DollarPerOz' | 'DollarPerPiece' | 'Percentage' — how the
    // displayed `price` should be interpreted.
    .addColumn('price_format', 'text')
    .addColumn('format', 'text') // '$' or '%'
    .addColumn('price_sign', 'text')
    // Provenance — the URL Aurbitrage scraped the price from, so the
    // operator can click through to the dealer's actual listing.
    .addColumn('data_source', 'text')
    .addColumn('notes', 'text')
    .addColumn('shipping_note', 'text')
    .addColumn('quote_date', 'timestamptz')
    .addColumn('ingested_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    CREATE INDEX aurbitrage_quotes_sku_idx
      ON aurbitrage_quotes (aurbitrage_sku_id)
  `.execute(db);
  await sql`
    CREATE INDEX aurbitrage_quotes_metal_idx
      ON aurbitrage_quotes (metal)
  `.execute(db);
  await sql`
    CREATE INDEX aurbitrage_quotes_dealer_idx
      ON aurbitrage_quotes (dealer)
  `.execute(db);

  // Singleton sync-state row. The CHECK constraint enforces id=1 so
  // upserts target the same row on every sync.
  await db.schema
    .createTable('aurbitrage_sync_state')
    .addColumn('id', 'integer', (c) =>
      c.primaryKey().defaultTo(1).check(sql`id = 1`),
    )
    .addColumn('last_synced_at', 'timestamptz')
    .addColumn('last_sync_status', 'text') // 'ok' | 'error'
    .addColumn('last_sync_message', 'text')
    .addColumn('last_sync_quote_count', 'integer')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('aurbitrage_sync_state').ifExists().execute();
  await db.schema.dropTable('aurbitrage_quotes').ifExists().execute();
}
