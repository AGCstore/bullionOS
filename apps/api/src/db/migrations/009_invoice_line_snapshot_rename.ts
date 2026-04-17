import { Kysely, sql } from 'kysely';

/**
 * 009_invoice_line_snapshot_rename
 *
 * Renames the three physical-attribute snapshot columns on invoice_line_items
 * to clearer names that match how the product catalog labels them:
 *
 *   unit_weight_troy_oz        → gross_weight_troy_oz
 *   unit_purity                → purity
 *   unit_metal_content_troy_oz → metal_content_troy_oz
 *
 * This is a pure RENAME — data is preserved in place. No column defaults,
 * constraints, or foreign keys are touched.
 *
 * Motivation: the `unit_` prefix was redundant (line items are inherently
 * per-unit), and `unit_weight_troy_oz` was being mis-populated with metal
 * content rather than gross weight. The rename forces every reader/writer
 * in the codebase to be updated; the snapshot-fidelity fix in the same
 * commit guarantees the values are now correct.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE invoice_line_items RENAME COLUMN unit_weight_troy_oz        TO gross_weight_troy_oz`.execute(db);
  await sql`ALTER TABLE invoice_line_items RENAME COLUMN unit_purity                TO purity`.execute(db);
  await sql`ALTER TABLE invoice_line_items RENAME COLUMN unit_metal_content_troy_oz TO metal_content_troy_oz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE invoice_line_items RENAME COLUMN metal_content_troy_oz TO unit_metal_content_troy_oz`.execute(db);
  await sql`ALTER TABLE invoice_line_items RENAME COLUMN purity                TO unit_purity`.execute(db);
  await sql`ALTER TABLE invoice_line_items RENAME COLUMN gross_weight_troy_oz  TO unit_weight_troy_oz`.execute(db);
}
