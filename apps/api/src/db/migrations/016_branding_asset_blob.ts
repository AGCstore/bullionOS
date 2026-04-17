import { Kysely } from 'kysely';

/**
 * 016_branding_asset_blob
 *
 * Move the logo (and any future branding image) from disk into Postgres.
 *
 * Why: Railway containers have an ephemeral filesystem. Every deploy spins
 * up a new container, so the logo file under /app/uploads disappears on
 * every push. The previous implementation stored the *path* in app_settings
 * and the bytes on disk — fine for dev, broken for prod.
 *
 * Shape: one row keyed by a short slug ('logo', 'favicon', …) with the raw
 * bytes and mime type. Small footprint (bank-grade logos are <500 KB each),
 * lives inside the same DB that's already backed up, and survives deploys.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('branding_assets')
    .addColumn('slug', 'text', (c) => c.primaryKey())
    .addColumn('mime', 'text', (c) => c.notNull())
    .addColumn('bytes', 'bytea', (c) => c.notNull())
    .addColumn('updated_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(new Date()),
    )
    .addColumn('updated_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('branding_assets').execute();
}
