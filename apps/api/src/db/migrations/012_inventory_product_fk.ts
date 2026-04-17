import { Kysely, sql } from 'kysely';

/**
 * 012_inventory_product_fk
 *
 * Completes the "product can be deleted without breaking history" work that
 * migration 010 started. Migration 010 covered invoice_line_items and
 * inventory_movements but missed the inventory table itself, whose FK was
 * still ON DELETE RESTRICT and blocked product deletion outright.
 *
 * Policy: inventory is a live counter of *current* stock. If a product is
 * gone, its current-stock row is meaningless — cascade-delete it. History
 * lives in inventory_movements (whose product_id is now nullable).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE inventory
      DROP CONSTRAINT IF EXISTS inventory_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  `.execute(db);

  // Also cascade deal_requests.product_id since its snapshot lives in
  // product_description (which clients fill in free-text). Keeping a
  // request tied to a deleted product just breaks joins.
  await sql`
    ALTER TABLE deal_requests
      DROP CONSTRAINT IF EXISTS deal_requests_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE deal_requests
      ADD CONSTRAINT deal_requests_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE deal_requests
      DROP CONSTRAINT IF EXISTS deal_requests_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE deal_requests
      ADD CONSTRAINT deal_requests_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  `.execute(db);

  await sql`
    ALTER TABLE inventory
      DROP CONSTRAINT IF EXISTS inventory_product_id_fkey
  `.execute(db);
  await sql`
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
  `.execute(db);
}
