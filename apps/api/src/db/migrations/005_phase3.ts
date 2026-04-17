import { Kysely, sql } from 'kysely';

/**
 * 005_phase3: price_quotes + deal_request_photos + user email prefs + 2FA recovery codes.
 *
 * Design notes:
 *  - price_quotes snapshots spot + computed unit_price with a short TTL (default 15 min).
 *    Converting to an invoice uses the captured price, not the live feed, even if spot
 *    has moved. After `expires_at` the quote can't be converted.
 *  - deal_request_photos stores filename + mime; file bytes live on disk (uploads/).
 *  - totp_recovery_codes: one-time bypass codes emitted at 2FA enrollment.
 *  - users.email_notifications defaults ON — clients opt out, not in.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- price_quotes ---
  await db.schema
    .createTable('price_quotes')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('client_id', 'uuid', (c) =>
      c.notNull().references('clients.id').onDelete('cascade'),
    )
    .addColumn('product_id', 'uuid', (c) =>
      c.notNull().references('products.id').onDelete('restrict'),
    )
    .addColumn('side', 'text', (c) => c.notNull().check(sql`side in ('buy','sell')`))
    .addColumn('quantity', 'integer', (c) => c.notNull().check(sql`quantity > 0`))
    .addColumn('spot_price_per_oz', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('unit_price', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('line_total', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('premium_type', 'text', (c) =>
      c.notNull().check(sql`premium_type in ('percent','flat')`),
    )
    .addColumn('premium_value', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('converted_invoice_id', 'uuid', (c) =>
      c.references('invoices.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('price_quotes_client_idx')
    .on('price_quotes')
    .columns(['client_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('price_quotes_expires_idx')
    .on('price_quotes')
    .column('expires_at')
    .execute();

  // --- deal_request_photos ---
  await db.schema
    .createTable('deal_request_photos')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('deal_request_id', 'uuid', (c) =>
      c.notNull().references('deal_requests.id').onDelete('cascade'),
    )
    .addColumn('disk_path', 'text', (c) => c.notNull())
    .addColumn('mime_type', 'text', (c) => c.notNull())
    .addColumn('byte_size', 'integer', (c) => c.notNull())
    .addColumn('position', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('uploaded_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('deal_request_photos_req_idx')
    .on('deal_request_photos')
    .columns(['deal_request_id', 'position'])
    .execute();

  // --- user email preferences ---
  await db.schema
    .alterTable('users')
    .addColumn('email_notifications', 'boolean', (c) => c.notNull().defaultTo(true))
    .execute();

  // --- TOTP recovery codes ---
  await db.schema
    .createTable('totp_recovery_codes')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (c) =>
      c.notNull().references('users.id').onDelete('cascade'),
    )
    // SHA-256 of the raw code, never the code itself.
    .addColumn('code_hash', 'text', (c) => c.notNull().unique())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('totp_recovery_user_idx')
    .on('totp_recovery_codes')
    .columns(['user_id', 'used_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('totp_recovery_codes').ifExists().execute();
  await db.schema.alterTable('users').dropColumn('email_notifications').execute();
  await db.schema.dropTable('deal_request_photos').ifExists().execute();
  await db.schema.dropTable('price_quotes').ifExists().execute();
}
