import { Kysely, sql } from 'kysely';

/**
 * 032_supplier_prices
 *
 * Wholesale supplier daily pricing snapshots. First consumer: RARCOA
 * (rarcoa.com) — they email AGC a daily PDF goldsheet with buy/sell
 * indications across uncertified gold, certified gold (MS61-MS66),
 * Morgan/Peace/GSA silver dollars. Operators currently copy the PDF
 * into a Google Sheet (Sheet3 = raw RARCOA, Sheet1 = AGC marked-down
 * prices via per-product % multipliers). This table replaces Sheet3
 * and the admin UI computes the Sheet1-equivalent using a hard-coded
 * markdown config in the rarcoa service.
 *
 * Shape:
 *   - supplier: vendor slug ('rarcoa', 'apmex' later, etc.)
 *   - section: grouping within a supplier's sheet (e.g. 'uncertified_gold',
 *     'certified_gold', 'morgan_dollar', 'peace_dollar', 'gsa_cc').
 *   - product: coin type label exactly as the supplier prints it
 *     ("$1 Type I", "$20 St. Gaudens", "MS-63", "1878").
 *   - grade: quality/condition bucket ('VF' | 'XF' | 'AU' | 'BU' |
 *     'MS61'..'MS66' | 'NGC/PCGS' | 'Toned/Tarn' | 'NoUNC' | 'UNC').
 *   - raw_bid / raw_ask: RARCOA publishes bid/ask; nullable because
 *     many cells are "-" (no quote) or "Call / -" (call for price).
 *   - ngc_only: RARCOA prefixes NGC-only cells with "N" (e.g.
 *     "N1685 / 1785"). Tracked so the admin UI can flag them.
 *   - as_of_date: the date the supplier's sheet was dated for
 *     (extracted from "Quotes as of: M/D/YY HH:MM" in the header).
 *   - basis_gold: spot gold basis the supplier was pricing against
 *     (top of their sheet). Informational — admin UI shows it for
 *     sanity-checking that today's basis matches today's spot.
 *   - source_ref: loose provenance ("upload", an email message-id
 *     later, or "paste"). Audit-only; no functional role.
 *
 * Uniqueness:
 *   (supplier, as_of_date, section, product, grade) is the natural
 *   key. A unique constraint lets repeat-uploads (same day's sheet
 *   uploaded twice) UPSERT idempotently rather than accumulate dup
 *   rows. as_of_date is date-only (not timestamp) because the sheet
 *   is published once per day and time-of-publish is stored in a
 *   separate column on the header record (see supplier_price_sheets).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('supplier_price_sheets')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('supplier', 'text', (c) => c.notNull())
    .addColumn('as_of_date', 'date', (c) => c.notNull())
    .addColumn('as_of_time', 'text')
    .addColumn('basis_gold', sql`numeric(20, 2)`)
    .addColumn('source_ref', 'text')
    .addColumn('source_filename', 'text')
    .addColumn('raw_text', 'text')
    .addColumn('ingested_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('ingested_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('supplier_price_sheets_supplier_date_uq', [
      'supplier',
      'as_of_date',
    ])
    .execute();

  await db.schema
    .createTable('supplier_prices')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('sheet_id', 'uuid', (c) =>
      c
        .notNull()
        .references('supplier_price_sheets.id')
        .onDelete('cascade'),
    )
    .addColumn('supplier', 'text', (c) => c.notNull())
    .addColumn('section', 'text', (c) => c.notNull())
    .addColumn('product', 'text', (c) => c.notNull())
    .addColumn('grade', 'text', (c) => c.notNull())
    .addColumn('raw_bid', sql`numeric(20, 2)`)
    .addColumn('raw_ask', sql`numeric(20, 2)`)
    .addColumn('ngc_only', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('as_of_date', 'date', (c) => c.notNull())
    .addColumn('ingested_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    CREATE INDEX supplier_prices_supplier_date_idx
      ON supplier_prices (supplier, as_of_date DESC)
  `.execute(db);
  await sql`
    CREATE INDEX supplier_prices_sheet_idx
      ON supplier_prices (sheet_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('supplier_prices').ifExists().execute();
  await db.schema.dropTable('supplier_price_sheets').ifExists().execute();
}
