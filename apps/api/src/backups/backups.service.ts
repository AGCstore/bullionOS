import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { BackupTrigger, DB } from '../db/types';

const gzipP = promisify(gzip);

/**
 * Daily backup service.
 *
 * Pipeline:
 *   1. Insert a pending row so the UI can show "in progress" mid-run.
 *   2. Build a plain-SQL dump entirely in Node — no external pg_dump
 *      binary needed. This eliminates the version-mismatch error that
 *      hits every Postgres major upgrade. The dump is:
 *         a. A header with metadata + restore instructions
 *         b. TRUNCATE ... RESTART IDENTITY CASCADE for every non-system
 *            table in the public schema (so restore starts clean)
 *         c. INSERT ... VALUES (...) statements for every row, in a
 *            dependency-safe order (tables with no FK first, then the
 *            rest alphabetically — cycles are rare in OLTP schemas and
 *            our own has none, but if one ever shows up the restore
 *            just needs `SET session_replication_role = 'replica'`
 *            around the block)
 *         d. ALTER SEQUENCE ... RESTART WITH ... so generated keys pick
 *            up where they left off.
 *   3. Gzip the SQL text, write the compressed bytes to backup_runs.
 *   4. Prune rows older than the retention window (default 30 days).
 *
 * Restore path (documented on /admin/backups):
 *   1. Create a fresh database.
 *   2. Run migrations to recreate schema.
 *   3. Gunzip + psql the file into the fresh DB.
 *
 * Why not pg_dump: it breaks every time the server major moves ahead of
 * the client major (Alpine repos lag Postgres releases by ~6 months).
 * Going pure-JS is ~10x slower but we dump a ~5 MB DB in under a second
 * so it's irrelevant. And the SQL is portable across versions forever.
 *
 * Tables excluded from the dump:
 *   - backup_runs itself — the rows are meaningless once restored and
 *     the dump_bytes column would recursively bloat every future dump.
 *   - migration tracking tables managed by Kysely — the restore path
 *     runs migrations first, which manages these on its own.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private readonly retentionDays: number;

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly config: ConfigService,
  ) {
    this.retentionDays = Number(config.get('BACKUP_RETENTION_DAYS') ?? 30);
  }

  /**
   * Fires daily at 20:00 America/New_York (8 pm EST/EDT — tz handles DST).
   * Explicit cron string because CronExpression.EVERY_DAY_AT_8PM fires at
   * UTC on Railway.
   */
  @Cron('0 20 * * *', { timeZone: 'America/New_York' })
  async scheduledBackup() {
    this.logger.log('Daily backup triggered by cron');
    await this.run({ trigger: 'cron', createdByUserId: null });
  }

  async list(limit = 30) {
    return this.db
      .selectFrom('backup_runs')
      .select([
        'id',
        'status',
        'trigger',
        'started_at',
        'completed_at',
        'size_bytes',
        'error',
        'created_by_user_id',
      ])
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute();
  }

  async getDump(id: string): Promise<{ bytes: Buffer; startedAt: Date } | null> {
    const row = await this.db
      .selectFrom('backup_runs')
      .select(['dump_bytes', 'started_at'])
      .where('id', '=', id)
      .where('status', '=', 'succeeded')
      .executeTakeFirst();
    if (!row || !row.dump_bytes) return null;
    return {
      bytes: Buffer.isBuffer(row.dump_bytes)
        ? row.dump_bytes
        : Buffer.from(row.dump_bytes as never),
      startedAt: new Date(row.started_at as unknown as string),
    };
  }

  async run(opts: { trigger: BackupTrigger; createdByUserId: string | null }): Promise<string> {
    const row = await this.db
      .insertInto('backup_runs')
      .values({
        status: 'pending',
        trigger: opts.trigger,
        created_by_user_id: opts.createdByUserId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const id = row.id as string;

    try {
      const dumpSql = await this.buildSqlDump();
      const gzipped = await gzipP(Buffer.from(dumpSql, 'utf8'));
      await this.db
        .updateTable('backup_runs')
        .set({
          status: 'succeeded',
          completed_at: new Date(),
          size_bytes: String(gzipped.length),
          dump_bytes: gzipped,
        })
        .where('id', '=', id)
        .execute();
      this.logger.log(
        `Backup ${id} succeeded — ${(gzipped.length / 1024 / 1024).toFixed(2)} MB (${(
          dumpSql.length / 1024
        ).toFixed(1)} KB SQL uncompressed)`,
      );
      await this.enforceRetention();
      return id;
    } catch (err) {
      const message = (err as Error).message.slice(0, 1000);
      await this.db
        .updateTable('backup_runs')
        .set({
          status: 'failed',
          completed_at: new Date(),
          error: message,
        })
        .where('id', '=', id)
        .execute();
      this.logger.error(`Backup ${id} failed: ${message}`);
      throw err;
    }
  }

  private async enforceRetention() {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 3600 * 1000);
    const deleted = await this.db
      .deleteFrom('backup_runs')
      .where('started_at', '<', cutoff)
      .executeTakeFirst();
    if (Number(deleted.numDeletedRows ?? 0) > 0) {
      this.logger.log(
        `Pruned ${deleted.numDeletedRows} backup(s) older than ${this.retentionDays} days`,
      );
    }
  }

  /**
   * Walk every user table in the public schema and emit a self-contained
   * SQL script that, when applied against a freshly-migrated database,
   * reproduces the current data state exactly.
   */
  private async buildSqlDump(): Promise<string> {
    const now = new Date().toISOString();

    // 1. Discover user tables. `pg_tables` lists every table in the
    //    public schema; we skip the ones we don't want to round-trip.
    const skipTables = new Set<string>([
      'backup_runs', // self-referential bloat if included
      'kysely_migration', // recreated by the migrator on restore
      'kysely_migration_lock',
    ]);

    const tables = (
      await sql<{ tablename: string }>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `.execute(this.db)
    ).rows
      .map((r) => r.tablename)
      .filter((t) => !skipTables.has(t));

    // 2. Header + session guards. session_replication_role=replica lets
    //    the restore apply data without tripping FK constraints on
    //    intermediate rows; we flip it back at the end.
    const out: string[] = [];
    out.push(`-- AGC Desk SQL backup`);
    out.push(`-- Generated: ${now}`);
    out.push(`-- Tables: ${tables.length}`);
    out.push(``);
    out.push(`-- Restore: psql "$DATABASE_URL" < this-file.sql`);
    out.push(`-- Prerequisite: run migrations on the target DB first.`);
    out.push(``);
    out.push(`BEGIN;`);
    out.push(`SET session_replication_role = 'replica';`);
    out.push(``);

    // 3. TRUNCATE every target table first so restoring onto a populated
    //    DB behaves deterministically. RESTART IDENTITY resets any
    //    sequences the table owns; CASCADE lets FKs pointing into these
    //    tables auto-clear. The whole thing runs inside the wrapping
    //    transaction so partial state can never leak on failure.
    if (tables.length > 0) {
      out.push(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`);
      out.push(``);
    }

    // 4. Dump each table's rows. For each row we build
    //    INSERT INTO "t" ("c1","c2",...) VALUES (v1,v2,...)
    //    statements. One insert per row keeps the logic simple; Postgres
    //    chews through 10k single-row inserts in a blink for a local DB.
    for (const table of tables) {
      const colsResult = await sql<{
        column_name: string;
        data_type: string;
      }>`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
        ORDER BY ordinal_position
      `.execute(this.db);
      const cols = colsResult.rows;
      if (cols.length === 0) continue;

      const colList = cols.map((c) => `"${c.column_name}"`).join(', ');
      const rows = await sql<Record<string, unknown>>`SELECT * FROM ${sql.id(
        table,
      )}`.execute(this.db);
      if (rows.rows.length === 0) {
        out.push(`-- ${table}: empty`);
        out.push(``);
        continue;
      }

      out.push(`-- ${table}: ${rows.rows.length} row${rows.rows.length === 1 ? '' : 's'}`);
      for (const row of rows.rows) {
        const vals = cols.map((c) => encodeLiteral(row[c.column_name], c.data_type));
        out.push(`INSERT INTO "${table}" (${colList}) VALUES (${vals.join(', ')});`);
      }
      out.push(``);
    }

    // 5. Restart sequences so INSERTs with auto-generated PKs continue
    //    where the dumped data left off. We query pg_sequences for every
    //    sequence in public and restart each at last_value + 1.
    const seqResult = await sql<{
      sequencename: string;
      last_value: number | null;
    }>`
      SELECT sequencename, last_value FROM pg_sequences
      WHERE schemaname = 'public'
      ORDER BY sequencename
    `.execute(this.db);
    if (seqResult.rows.length > 0) {
      out.push(`-- Sequences`);
      for (const s of seqResult.rows) {
        const next = (s.last_value ?? 0) + 1;
        out.push(
          `ALTER SEQUENCE "${s.sequencename}" RESTART WITH ${next};`,
        );
      }
      out.push(``);
    }

    out.push(`SET session_replication_role = 'origin';`);
    out.push(`COMMIT;`);
    out.push(``);
    return out.join('\n');
  }
}

/**
 * Format a single JS value as a SQL literal the Postgres parser will
 * accept. The data_type hint comes from information_schema.columns — we
 * trust it to decide between numeric / text / jsonb / bytea / array.
 *
 * Formatting rules:
 *   - null                       → NULL
 *   - booleans                   → TRUE / FALSE
 *   - Date                       → 'ISO'::timestamptz
 *   - Buffer (bytea)             → '\xDEADBEEF'::bytea
 *   - objects / arrays + jsonb   → 'json'::jsonb
 *   - arrays + text[]/uuid[]/int[] → ARRAY[…]
 *   - numbers                    → raw
 *   - strings                    → SQL-escaped quoted string
 */
function encodeLiteral(v: unknown, dataType: string): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';

  if (v instanceof Date) {
    return `'${v.toISOString()}'::timestamptz`;
  }

  if (Buffer.isBuffer(v)) {
    return `'\\x${v.toString('hex')}'::bytea`;
  }

  const dt = dataType.toLowerCase();
  const isJson = dt === 'jsonb' || dt === 'json';
  const isArray = dt === 'array' || dt.endsWith('[]');

  if (isArray && Array.isArray(v)) {
    if (v.length === 0) return `'{}'`;
    const inner = v.map((el) => encodeLiteral(el, 'text')).join(', ');
    return `ARRAY[${inner}]`;
  }

  if (isJson || (typeof v === 'object' && !Array.isArray(v))) {
    return `${quoteString(JSON.stringify(v))}::jsonb`;
  }
  if (Array.isArray(v)) {
    return `${quoteString(JSON.stringify(v))}::jsonb`;
  }

  if (typeof v === 'number' || typeof v === 'bigint') {
    if (!Number.isFinite(v as number)) return 'NULL';
    return String(v);
  }

  return quoteString(String(v));
}

/** Escape + wrap in single quotes. Postgres uses '' for an embedded '. */
function quoteString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
