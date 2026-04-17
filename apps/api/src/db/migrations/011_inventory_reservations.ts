import { Kysely, sql } from 'kysely';

/**
 * 011_inventory_reservations
 *
 * Backfills real reservation semantics onto the inventory subsystem:
 *   - A new `reserved_delta` column on inventory_movements so a single audit
 *     row can describe changes to `quantity_on_hand`, `quantity_reserved`,
 *     or both. (Pure reserves have delta=0, reserved_delta=+qty; shipments
 *     that consume a reservation have delta=-qty, reserved_delta=-qty.)
 *   - Two additional reason codes: 'reservation' and 'reservation_release'.
 *   - Relaxed CHECK: a movement is valid if EITHER counter changes.
 *
 * No data migration needed: existing rows stay as `reserved_delta=0` which
 * exactly matches their actual meaning (pre-reservation-era movements only
 * touched quantity_on_hand).
 *
 * Reservation workflow (enforced in app code, not schema):
 *   draft      → finalized   : reserve
 *   finalized  → paid        : no-op
 *   finalized  → shipped     : consume (= decrement both counters)
 *   paid       → shipped     : consume
 *   finalized  → canceled    : release
 *   paid       → canceled    : release
 *   shipped    → canceled    : no-op (needs an explicit return flow later)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('inventory_movements')
    .addColumn('reserved_delta', 'integer', (c) => c.notNull().defaultTo(0))
    .execute();

  // Drop the old `delta <> 0` check; movements can now change only reserved_delta.
  await sql`
    ALTER TABLE inventory_movements
      DROP CONSTRAINT IF EXISTS inventory_movements_delta_check
  `.execute(db);

  await sql`
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_nonzero_check
      CHECK (delta <> 0 OR reserved_delta <> 0)
  `.execute(db);

  // Extend the reason enum-via-CHECK.
  await sql`
    ALTER TABLE inventory_movements
      DROP CONSTRAINT IF EXISTS inventory_movements_reason_check
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_reason_check
      CHECK (reason IN (
        'purchase','sale','adjustment','return','damage','manual',
        'reservation','reservation_release'
      ))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Reverting is dangerous if reservation movements exist; this simply
  // restores the pre-reservation shape and will fail if any rows have
  // delta=0 (pure reserves).
  await sql`
    ALTER TABLE inventory_movements
      DROP CONSTRAINT IF EXISTS inventory_movements_reason_check
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_reason_check
      CHECK (reason IN ('purchase','sale','adjustment','return','damage','manual'))
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      DROP CONSTRAINT IF EXISTS inventory_movements_nonzero_check
  `.execute(db);
  await sql`
    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_delta_check
      CHECK (delta <> 0)
  `.execute(db);
  await db.schema.alterTable('inventory_movements').dropColumn('reserved_delta').execute();
}
