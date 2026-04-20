import { Kysely, sql } from 'kysely';

/**
 * 025_wholesale_ar_index
 *
 * The wholesale receivables query in InvoicesService.listOutstandingWholesale
 * previously filtered by `status = 'finalized'`, and migration 022
 * added a matching partial index:
 *
 *   invoices_outstanding_by_client_idx
 *     ON invoices (client_id) WHERE status = 'finalized'
 *
 * New rule (Apr 2026): wholesalers ship first and pay a few days
 * later, so 'shipped' invoices with no `paid_at` must ALSO count as
 * outstanding. The query now filters:
 *
 *   status IN ('finalized', 'shipped') AND paid_at IS NULL
 *
 * Replace the partial index with one that matches the new predicate.
 * Same column + same WHERE clause as the query so the planner picks
 * it up.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS invoices_outstanding_by_client_idx`.execute(db);
  await sql`
    CREATE INDEX invoices_outstanding_by_client_idx
      ON invoices (client_id)
      WHERE status IN ('finalized', 'shipped') AND paid_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS invoices_outstanding_by_client_idx`.execute(db);
  await sql`
    CREATE INDEX invoices_outstanding_by_client_idx
      ON invoices (client_id)
      WHERE status = 'finalized'
  `.execute(db);
}
