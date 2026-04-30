import { Kysely, sql } from 'kysely';

/**
 * 037_invoice_attachments
 *
 * Per-invoice attached files — photos taken at scrap intake for
 * compliance (Georgia precious-metal-dealer rules + general buyer
 * fraud prevention): photo of the customer's ID, photo of the
 * customer themselves, photo(s) of the items being purchased.
 *
 * Same inline-bytea pattern as client_attachments (mig 028) and
 * branding_assets (mig 016) — Postgres handles single-tenant blob
 * volume fine, S3 is over-engineered for AGC's scale.
 *
 * Visibility note: these are operator-only. The invoice PDF
 * generator + the client-portal invoice view both ignore this
 * table. Cascade-on-invoice-delete keeps the table self-cleaning
 * if an invoice is ever void+recreated.
 *
 * Columns
 *   - kind: 'id' | 'client_photo' | 'item' | 'other'. Kept as text
 *     (no enum check) so operators can add new kinds without a
 *     migration. The scrap invoice UI exposes the three named
 *     buckets; "other" is the fallback for ad-hoc adds.
 *   - filename / mime / bytes / size_bytes: stored as-uploaded.
 *   - uploaded_by_user_id: ON DELETE SET NULL so deleting a user
 *     doesn't cascade into the audit trail.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('invoice_attachments')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('invoice_id', 'uuid', (c) =>
      c.notNull().references('invoices.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (c) => c.notNull().defaultTo('other'))
    .addColumn('filename', 'text', (c) => c.notNull())
    .addColumn('mime', 'text', (c) => c.notNull())
    .addColumn('bytes', 'bytea', (c) => c.notNull())
    .addColumn('size_bytes', 'integer', (c) => c.notNull())
    .addColumn('uploaded_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // The render path is "give me attachments for invoice X" — composite
  // index keeps that one index scan even with thousands of rows.
  await sql`
    CREATE INDEX invoice_attachments_invoice_created_idx
      ON invoice_attachments (invoice_id, created_at DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('invoice_attachments').ifExists().execute();
}
