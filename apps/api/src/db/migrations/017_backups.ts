import { Kysely, sql } from 'kysely';

/**
 * 017_backups
 *
 * Backup-runs ledger. Each row is one full-DB snapshot produced by
 * `pg_dump --format=custom` and then gzipped. Storing the bytes inside
 * the DB is a deliberate choice for a small operation — it piggy-backs
 * on Railway's own point-in-time DB backups and needs zero external
 * credentials. Retention is enforced by the service layer (default 30
 * days). Callers who need off-site storage can bolt an S3 uploader onto
 * the same code path later; the schema doesn't need to change.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('backup_runs')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // 'pending' while running, 'succeeded' or 'failed' on completion.
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    // Which scheduled trigger or user fired this. Values: 'cron', 'manual'.
    .addColumn('trigger', 'text', (c) => c.notNull().defaultTo('manual'))
    .addColumn('started_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn('completed_at', 'timestamptz')
    // Compressed size in bytes — the UI uses this to render a human-friendly
    // file size without having to stream the blob.
    .addColumn('size_bytes', 'bigint')
    // Raw gzipped pg_dump output. Null while pending or on failure.
    .addColumn('dump_bytes', 'bytea')
    // Error message if status = 'failed'. Kept short on purpose (~1 KB).
    .addColumn('error', 'text')
    .addColumn('created_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('backup_runs_started_at_idx')
    .on('backup_runs')
    .column('started_at')
    .execute();

  await sql`
    ALTER TABLE backup_runs
      ADD CONSTRAINT backup_runs_status_chk
      CHECK (status IN ('pending','succeeded','failed'))
  `.execute(db);
  await sql`
    ALTER TABLE backup_runs
      ADD CONSTRAINT backup_runs_trigger_chk
      CHECK (trigger IN ('cron','manual'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('backup_runs').execute();
}
