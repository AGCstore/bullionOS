import { Kysely, sql } from 'kysely';

/**
 * 001_init: base schema for auth + clients + audit.
 *
 * Design notes:
 *  - UUIDs (pgcrypto gen_random_uuid) as primary keys — client-portal-friendly.
 *  - citext for emails so lookups are case-insensitive and unique constraints work as users expect.
 *  - refresh tokens store SHA-256 hashes only; raw tokens never hit the database.
 *  - audit_logs.metadata is jsonb for flexible event payloads without schema churn.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS citext`.execute(db);

  // --- users ---
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('email', sql`citext`, (c) => c.notNull().unique())
    .addColumn('password_hash', 'text', (c) => c.notNull())
    .addColumn('role', 'text', (c) =>
      c.notNull().check(sql`role in ('admin','staff','client')`),
    )
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('active')
        .check(sql`status in ('active','restricted','disabled')`),
    )
    .addColumn('is_2fa_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('totp_secret', 'text')
    .addColumn('last_login_at', 'timestamptz')
    .addColumn('failed_login_count', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('locked_until', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('users_role_idx').on('users').column('role').execute();
  await db.schema.createIndex('users_status_idx').on('users').column('status').execute();

  // --- clients ---
  await db.schema
    .createTable('clients')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null').unique(),
    )
    .addColumn('first_name', 'text', (c) => c.notNull())
    .addColumn('last_name', 'text', (c) => c.notNull())
    .addColumn('email', sql`citext`)
    .addColumn('phone', 'text')
    .addColumn('address_line1', 'text')
    .addColumn('address_line2', 'text')
    .addColumn('city', 'text')
    .addColumn('region', 'text')
    .addColumn('postal_code', 'text')
    .addColumn('country', 'text')
    .addColumn('is_portal_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('notes', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('clients_email_idx').on('clients').column('email').execute();
  await db.schema.createIndex('clients_user_id_idx').on('clients').column('user_id').execute();
  await db.schema
    .createIndex('clients_name_idx')
    .on('clients')
    .columns(['last_name', 'first_name'])
    .execute();

  // --- refresh_tokens ---
  await db.schema
    .createTable('refresh_tokens')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('user_id', 'uuid', (c) =>
      c.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'text', (c) => c.notNull().unique())
    .addColumn('user_agent', 'text')
    .addColumn('ip_address', sql`inet`)
    .addColumn('issued_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('replaced_by', 'uuid', (c) =>
      c.references('refresh_tokens.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('refresh_tokens_user_id_idx')
    .on('refresh_tokens')
    .column('user_id')
    .execute();
  await db.schema
    .createIndex('refresh_tokens_expires_idx')
    .on('refresh_tokens')
    .column('expires_at')
    .execute();

  // --- audit_logs ---
  await db.schema
    .createTable('audit_logs')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('actor_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('entity_type', 'text')
    .addColumn('entity_id', 'text')
    .addColumn('metadata', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('ip_address', sql`inet`)
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('audit_logs_actor_idx')
    .on('audit_logs')
    .column('actor_user_id')
    .execute();
  await db.schema
    .createIndex('audit_logs_action_idx')
    .on('audit_logs')
    .column('action')
    .execute();
  await db.schema
    .createIndex('audit_logs_created_idx')
    .on('audit_logs')
    .column('created_at')
    .execute();

  // --- trigger: updated_at auto-touch ---
  await sql`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);

  for (const table of ['users', 'clients']) {
    await sql`
      CREATE TRIGGER ${sql.raw(`${table}_set_updated_at`)}
      BEFORE UPDATE ON ${sql.raw(table)}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['clients', 'users']) {
    await sql`DROP TRIGGER IF EXISTS ${sql.raw(`${table}_set_updated_at`)} ON ${sql.raw(table)}`.execute(db);
  }
  await sql`DROP FUNCTION IF EXISTS set_updated_at()`.execute(db);

  await db.schema.dropTable('audit_logs').ifExists().execute();
  await db.schema.dropTable('refresh_tokens').ifExists().execute();
  await db.schema.dropTable('clients').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
}
