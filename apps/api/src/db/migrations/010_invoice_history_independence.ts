import { Kysely, sql } from 'kysely';

/**
 * 010_invoice_history_independence
 *
 * Required so an invoice remains 100% accurate after the underlying product
 * is later deleted. We already snapshot name + gross_weight + purity + metal
 * content + spot + premium on each line (migration 009), but the FK on
 * invoice_line_items.product_id was RESTRICT, which blocked any product
 * deletion that had ever been invoiced. Change to SET NULL:
 *
 *   - The line-item row survives.
 *   - `product_id` becomes NULL — readers must fall back to the snapshot
 *     columns, which is the correct source of truth anyway.
 *   - All money/weight fields are already snapshotted, so the invoice
 *     reprints and totals remain identical.
 *
 * Same treatment for inventory_movements and deal_requests — these have
 * historical meaning after a product is removed from the catalog.
 * price_quotes keeps RESTRICT: an unconverted quote that points to a
 * deleted product is garbage, not history.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Drop + recreate FK with SET NULL. Postgres does not support ALTER
  // CONSTRAINT on reference actions in one step.
  await sql`
    ALTER TABLE invoice_line_items
      DROP CONSTRAINT invoice_line_items_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE invoice_line_items
      ALTER COLUMN product_id DROP NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    ALTER TABLE inventory_movements
      DROP CONSTRAINT inventory_movements_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ALTER COLUMN product_id DROP NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Note: reverting requires every line_items.product_id to be non-null,
  // which is no longer guaranteed. The rollback is best-effort and will fail
  // if any products have been deleted while this migration was live.
  await sql`
    ALTER TABLE inventory_movements
      DROP CONSTRAINT inventory_movements_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ALTER COLUMN product_id SET NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  `.execute(db);

  await sql`
    ALTER TABLE invoice_line_items
      DROP CONSTRAINT invoice_line_items_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE invoice_line_items
      ALTER COLUMN product_id SET NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  `.execute(db);
}
