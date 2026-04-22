import { Kysely, sql } from 'kysely';

/**
 * 031_historical_invoices
 *
 * Day-granular backfill of invoices that were written in another
 * system before AGC Desk went live. One row per past invoice, totals
 * only (no line items, no inventory movement). Feeds into the KPI
 * rollup via UNION with the `invoices` table.
 *
 * Complements migration 027's `kpi_manual_entries` (month-granular,
 * coarse bulk totals) — the two coexist: monthly for broad backfill,
 * this one for per-invoice precision.
 *
 * Columns
 *   - date: the day the original invoice was written. DATE (no time
 *     component) — accountant shouldn't care about 3:42 PM vs 4:01 PM
 *     when reconciling, and storing a date instead of a timestamp
 *     avoids timezone drift in the KPI rollup (the live-invoice side
 *     already uses `created_at AT TIME ZONE 'America/New_York'`).
 *
 *   - type: 'buy' or 'sell'. Mirrors the invoices table's `type` so
 *     the UNION in the KPI rollup can treat both sources uniformly.
 *
 *   - amount: the grand total of the original invoice in USD.
 *
 *   - is_wholesale: flag that rolls this entry into the Wholesale
 *     subtotal on KPI. Not inferred from client_id — accountant
 *     explicitly marks per row so old-system tags translate exactly.
 *
 *   - client_id: optional FK. If the past-invoice's customer is
 *     already a Desk client, link to their record. ON DELETE SET NULL
 *     so deleting a client doesn't nuke the history.
 *
 *   - client_name: free-text fallback when client_id is null — many
 *     walk-in / one-off clients from the old system won't ever become
 *     Desk clients and still need an identifier for the audit trail.
 *
 *   - reference: external invoice number from the old system
 *     ("POS-4501", "QB-2841", etc.) so a future audit can trace this
 *     row back to the original document.
 *
 *   - notes: free-form accountant notes.
 *
 *   - created_by_user_id: who typed this in. Helpful when accounting@
 *     and Hunter are both entering.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('historical_invoices')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('date', 'date', (col) => col.notNull())
    .addColumn('type', 'text', (col) =>
      col.notNull().check(sql`type IN ('buy', 'sell')`),
    )
    .addColumn('amount', 'numeric(12, 2)', (col) =>
      col.notNull().check(sql`amount >= 0`),
    )
    .addColumn('is_wholesale', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('client_id', 'uuid', (col) =>
      col.references('clients.id').onDelete('set null'),
    )
    .addColumn('client_name', 'text')
    .addColumn('reference', 'text')
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_by_user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .execute();

  // KPI rollup filters + sorts by date; this gets us O(log n) lookups
  // even if the accountant enters years of history.
  await db.schema
    .createIndex('historical_invoices_date_idx')
    .on('historical_invoices')
    .columns(['date'])
    .execute();

  // Touches the updated_at on every row modification. Matches the
  // pattern used by invoices + kpi_manual_entries (both have the same
  // trigger). Consolidating in case a future refactor wants to lift
  // these into a shared helper.
  await sql`
    CREATE TRIGGER historical_invoices_set_updated_at
    BEFORE UPDATE ON historical_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS historical_invoices_set_updated_at ON historical_invoices`.execute(db);
  await db.schema.dropTable('historical_invoices').execute();
}
