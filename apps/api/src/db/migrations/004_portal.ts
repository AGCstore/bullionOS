import { Kysely, sql } from 'kysely';

/**
 * 004_portal: deal_requests + shipments + notifications.
 *
 * Design notes:
 *  - deal_requests are client-submitted intents to buy/sell. They live
 *    independently of invoices and can reference a known product_id OR
 *    a free-text product_description for items not in the catalog.
 *  - shipments are 1:1 with an invoice (for now); a carrier enum + tracking
 *    number is the minimum we need to link out to carrier sites. Real-time
 *    carrier tracking APIs land in Phase 3.
 *  - notifications are per-user inbox rows so the client portal can show
 *    an unread badge. Email/SMS delivery is Phase 3; until then this is
 *    the source of truth.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- deal_requests ---
  await db.schema
    .createTable('deal_requests')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('client_id', 'uuid', (c) =>
      c.notNull().references('clients.id').onDelete('restrict'),
    )
    .addColumn('type', 'text', (c) => c.notNull().check(sql`type in ('buy','sell')`))
    // Either product_id (known catalog item) OR product_description (free text) must be set.
    .addColumn('product_id', 'uuid', (c) =>
      c.references('products.id').onDelete('set null'),
    )
    .addColumn('product_description', 'text')
    .addColumn('quantity', 'integer', (c) => c.check(sql`quantity is null or quantity > 0`))
    .addColumn('estimated_weight_troy_oz', 'numeric(20, 8)')
    .addColumn('metal', 'text', (c) =>
      c.check(sql`metal is null or metal in ('gold','silver','platinum','palladium')`),
    )
    .addColumn('notes', 'text')
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending','accepted','rejected','expired','converted')`),
    )
    .addColumn('responded_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('responded_at', 'timestamptz')
    .addColumn('response_message', 'text')
    // If accepted and converted into an invoice, link it here.
    .addColumn('converted_invoice_id', 'uuid', (c) =>
      c.references('invoices.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'deal_requests_product_ref',
      sql`product_id is not null or product_description is not null`,
    )
    .execute();

  await db.schema
    .createIndex('deal_requests_client_idx')
    .on('deal_requests')
    .columns(['client_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('deal_requests_status_idx')
    .on('deal_requests')
    .column('status')
    .execute();

  await sql`
    CREATE TRIGGER deal_requests_set_updated_at
    BEFORE UPDATE ON deal_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);

  // --- shipments ---
  await db.schema
    .createTable('shipments')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('invoice_id', 'uuid', (c) =>
      c.notNull().references('invoices.id').onDelete('cascade').unique(),
    )
    .addColumn('carrier', 'text', (c) =>
      c.notNull().check(sql`carrier in ('ups','fedex','usps','other')`),
    )
    .addColumn('tracking_number', 'text')
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('label_created')
        .check(
          sql`status in ('label_created','in_transit','out_for_delivery','delivered','exception','returned')`,
        ),
    )
    .addColumn('shipped_at', 'timestamptz')
    .addColumn('delivered_at', 'timestamptz')
    .addColumn('weight_lbs', 'numeric(10, 3)')
    .addColumn('insurance_amount', 'numeric(20, 8)')
    .addColumn('notes', 'text')
    .addColumn('created_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('shipments_status_idx')
    .on('shipments')
    .column('status')
    .execute();

  await sql`
    CREATE TRIGGER shipments_set_updated_at
    BEFORE UPDATE ON shipments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);

  // --- notifications ---
  await db.schema
    .createTable('notifications')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) =>
      c.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('title', 'text', (c) => c.notNull())
    .addColumn('body', 'text')
    .addColumn('link', 'text')
    .addColumn('metadata', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('read_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('notifications_user_unread_idx')
    .on('notifications')
    .columns(['user_id', 'read_at'])
    .execute();
  await db.schema
    .createIndex('notifications_user_created_idx')
    .on('notifications')
    .columns(['user_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of ['notifications', 'shipments', 'deal_requests']) {
    await sql`DROP TABLE IF EXISTS ${sql.raw(t)} CASCADE`.execute(db);
  }
}
