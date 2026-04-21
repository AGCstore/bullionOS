import { Kysely, sql } from 'kysely';

/**
 * 029_restock_subscriptions
 *
 * "Notify me when back in stock" signups from the public shop page.
 * Populated by the anonymous POST /public/restock-notify endpoint and
 * drained by a future job that watches inventory.applyMovement for
 * 0→positive transitions.
 *
 * Columns
 *   - product_id: FK, ON DELETE CASCADE — if the product is fully
 *     purged, the notification is meaningless.
 *   - email: normalized lowercase for dedupe. Stored verbatim after
 *     `.toLowerCase().trim()` — no hashing, operators need to see
 *     these in admin view.
 *   - token: opaque random string used for one-click unsubscribe.
 *     Unique so the unsubscribe URL can be constructed deterministically.
 *   - created_at / notified_at: when the signup happened and when
 *     the restock email went out (null until notified).
 *   - ip: requester IP at signup, best-effort rate limiting aid.
 *
 * UNIQUE (product_id, email) lets us UPSERT — same email signing up
 * twice for the same product is a no-op.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('restock_subscriptions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('product_id', 'uuid', (col) =>
      col.notNull().references('products.id').onDelete('cascade'),
    )
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('ip', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('notified_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('restock_subscriptions_product_email_uniq')
    .on('restock_subscriptions')
    .columns(['product_id', 'email'])
    .unique()
    .execute();

  // Partial index for the restock-watcher job — scans only pending
  // subscriptions per product. Raw SQL because Kysely's typed
  // createIndex doesn't parse IS NULL predicates without a cast.
  await sql`
    CREATE INDEX IF NOT EXISTS restock_subscriptions_product_unfilled
    ON restock_subscriptions (product_id)
    WHERE notified_at IS NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('restock_subscriptions').execute();
}
