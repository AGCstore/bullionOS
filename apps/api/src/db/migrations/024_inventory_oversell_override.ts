import { Kysely, sql } from 'kysely';

/**
 * 024_inventory_oversell_override
 *
 * Loosen two inventory CHECK constraints so the admin oversell override
 * can actually commit. The constraints used to provide belt-and-suspenders
 * for the app-layer guard in InventoryService.applyMovement — which was
 * fine when there was no legitimate way to need negative stock. AGC now
 * has a real use case: pre-sales against incoming shipments (customer
 * puts a deposit on a coin that arrives next week).
 *
 * Dropped:
 *   - inventory_quantity_on_hand_check  (implicit name from column-level
 *     `check(quantity_on_hand >= 0)` in migration 002). Allows on-hand to
 *     go negative when an admin consumes more than is on the shelf.
 *   - inventory_reserved_le_on_hand    (named table-level constraint).
 *     Allows reservations to exceed on-hand for pre-sale scenarios.
 *
 * Kept:
 *   - inventory_quantity_reserved_check (quantity_reserved >= 0) —
 *     reservation underflow is never a legitimate state. A release
 *     subtracting more than was reserved is always a bug.
 *
 * The admin-override gate stays in the app layer (force flag on
 * applyMovement + admin-role check in InvoicesService.updateStatus),
 * plus every movement that uses force is audit-logged with
 * force_oversell=true so the history is queryable.
 *
 * Postgres assigns column-level CHECK constraints the default name
 * `<table>_<column>_check`. Using `IF EXISTS` in the drop so the
 * migration is idempotent across environments that may have picked
 * up a different auto-generated name.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE inventory
      DROP CONSTRAINT IF EXISTS inventory_quantity_on_hand_check
  `.execute(db);

  await sql`
    ALTER TABLE inventory
      DROP CONSTRAINT IF EXISTS inventory_reserved_le_on_hand
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Rebuild both constraints as NOT VALID first, then VALIDATE in a
  // separate statement. If production already has negative stock from
  // an accepted oversell, the VALIDATE will fail — operator must run
  // adjustments to zero those out before reverting. That's intended;
  // rollback should surface stale negative state rather than hide it.
  await sql`
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_quantity_on_hand_check
      CHECK (quantity_on_hand >= 0) NOT VALID
  `.execute(db);
  await sql`
    ALTER TABLE inventory
      VALIDATE CONSTRAINT inventory_quantity_on_hand_check
  `.execute(db);

  await sql`
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_reserved_le_on_hand
      CHECK (quantity_reserved <= quantity_on_hand) NOT VALID
  `.execute(db);
  await sql`
    ALTER TABLE inventory
      VALIDATE CONSTRAINT inventory_reserved_le_on_hand
  `.execute(db);
}
