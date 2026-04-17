import { Kysely, sql } from 'kysely';

/**
 * 008_integrations: third-party API credentials, managed in-app by admins.
 *
 * Design:
 *  - One row per (provider). Providers are free-form strings so we can add
 *    new ones without migrations ('ups', 'fedex', 'usps', 'docusign', ...).
 *  - credentials_encrypted is the output of AES-256-GCM over the JSON payload.
 *    Format: nonce(12) || ciphertext || authTag(16). Stored as bytea.
 *  - display_hint is a non-secret masked preview (e.g., "sk_****AB12") that
 *    the admin UI can show without decrypting.
 *  - is_enabled lets admins pause an integration without clearing credentials.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('integrations')
    .addColumn('provider', 'text', (c) => c.primaryKey())
    .addColumn('credentials_encrypted', sql`bytea`, (c) => c.notNull())
    .addColumn('display_hint', 'text')
    .addColumn('is_enabled', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('last_tested_at', 'timestamptz')
    .addColumn('last_test_ok', 'boolean')
    .addColumn('last_test_message', 'text')
    .addColumn('updated_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    CREATE TRIGGER integrations_set_updated_at
    BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('integrations').ifExists().execute();
}
