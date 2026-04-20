import { Kysely, sql } from 'kysely';

/**
 * 027_kpi_manual_entries
 *
 * Pre-AGC-Desk history entry. AGC had a full year of activity before
 * this system went live; the KPI timeline on /admin/kpi and the
 * Dashboard's 12-month chart should be able to show that history
 * alongside the live data so year-over-year trends are visible.
 *
 * Table shape:
 *   - bucket_month: first-of-month date the entry is booked against.
 *     We lock to month granularity because that's the finest detail
 *     AGC can reconstruct for historical periods (QBO exports,
 *     hand-kept ledgers, etc.). The KPI rollup decides at query-time
 *     whether to surface these entries — only when the selected
 *     period is monthly or coarser (quarter/year).
 *   - category: sales / purchases / wholesale. Matches the three
 *     series the KPI endpoint already returns.
 *   - client_id: OPTIONAL and only meaningful when category='wholesale'.
 *     Per-wholesaler entries roll up to the single "wholesale" series
 *     in the chart, but stay tied to the client record so the
 *     reconciliation page can show per-wholesaler historical volume
 *     later. NULL allowed for wholesaler names that pre-date the
 *     clients table.
 *   - amount: numeric(20,2); same precision as invoices.total.
 *   - notes: free-text context (source spreadsheet, QBO month, etc.).
 *
 * No CHECK constraint binding category and client_id together because
 * migration-up-time data may not always have a clients row to match;
 * the service layer treats client_id as optional with a soft rule
 * "prefer it on wholesale entries."
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('kpi_manual_entries')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('bucket_month', 'date', (c) => c.notNull())
    .addColumn('category', 'text', (c) =>
      c.notNull().check(sql`category in ('sales','purchases','wholesale')`),
    )
    .addColumn('client_id', 'uuid', (c) =>
      // RESTRICT rather than SET NULL — an operator shouldn't silently
      // lose the tie between a historical wholesale entry and the
      // wholesaler client record by deleting the client. Force the
      // deletion path to clear the entry first.
      c.references('clients.id').onDelete('restrict'),
    )
    .addColumn('amount', 'numeric(20, 2)', (c) => c.notNull())
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // The rollup query filters by month range + groups by
  // bucket_month + category. A composite index makes that a single
  // index scan even as the table grows.
  await sql`
    CREATE INDEX kpi_manual_entries_bucket_category_idx
      ON kpi_manual_entries (bucket_month, category)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('kpi_manual_entries').ifExists().execute();
}
