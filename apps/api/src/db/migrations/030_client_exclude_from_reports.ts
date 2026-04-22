import { Kysely, sql } from 'kysely';

/**
 * 030_client_exclude_from_reports
 *
 * Adds a boolean flag that marks a client as "ignore for reporting."
 * Any invoice against a flagged client is excluded from:
 *   - /admin/invoices list views (all tabs)
 *   - /admin/kpi rollups (Purchases / Sales / Wholesale totals + chart)
 *   - /admin/kpi/wholesale-owed (outstanding wholesale AR)
 *
 * The invoice itself still exists in the DB and is reachable by direct
 * URL — the flag only hides it from aggregate views. Typical use: an
 * owner's personal client record that gets used for test transactions,
 * stock transfers, or private buys that shouldn't skew revenue totals.
 *
 * Default `false` so existing data is unchanged. Setting the flag is an
 * explicit operator action (a manual UPDATE, or a future toggle on the
 * client detail page).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('clients')
    .addColumn('exclude_from_reports', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute();

  // Partial index — most clients won't have this flag set, so a full
  // index would waste space. Filter queries that use 'exclude = false'
  // can still use the index via an IS DISTINCT FROM predicate.
  await sql`
    CREATE INDEX IF NOT EXISTS clients_excluded_from_reports_true
    ON clients (id)
    WHERE exclude_from_reports = true
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS clients_excluded_from_reports_true`.execute(db);
  await db.schema
    .alterTable('clients')
    .dropColumn('exclude_from_reports')
    .execute();
}
