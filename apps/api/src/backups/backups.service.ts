import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { BackupTrigger, DB } from '../db/types';

const gzipP = promisify(gzip);

/**
 * Daily backup service.
 *
 * Pipeline:
 *   1. Insert a pending row with status='pending' so the UI can show "in
 *      progress" even mid-run.
 *   2. Spawn `pg_dump --format=custom` against DATABASE_URL. Custom format
 *      is portable across PG major versions on the same-or-higher restore
 *      target and compresses a small DB like ours to a few MB.
 *   3. Pipe stdout into a Buffer, then gzip it again for the on-disk layer
 *      (belt+suspenders; custom format is already compressed but we don't
 *      control the exact ratio and want deterministic sizes for capacity
 *      planning).
 *   4. Upsert the completed row with status='succeeded', size, bytes.
 *   5. Prune rows older than the retention window (default 30 days).
 *
 * Failure paths:
 *   - pg_dump not found → status='failed', error='pg_dump binary missing'.
 *     The Dockerfile installs postgresql-client; local dev can `brew
 *     install postgresql` or skip.
 *   - DATABASE_URL missing → status='failed'.
 *   - Non-zero exit code from pg_dump → status='failed' with stderr.
 *
 * Off-site: a future commit can add an S3 uploader here that reads the
 * same bytes buffer. Schema doesn't need to change.
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
   * Fires daily at 20:00 America/New_York (8 pm EST — handles DST).
   *
   * We use a string cron expression rather than CronExpression.EVERY_DAY_AT_8PM
   * because we must pin the timezone; the preset runs in the container's
   * tz which is UTC on Railway.
   */
  @Cron('0 20 * * *', { timeZone: 'America/New_York' })
  async scheduledBackup() {
    this.logger.log('Daily backup triggered by cron');
    await this.run({ trigger: 'cron', createdByUserId: null });
  }

  async list(limit = 30) {
    return this.db
      .selectFrom('backup_runs')
      // Intentionally excluding dump_bytes from the list payload — it's the
      // heavy column and the UI only needs sizes/timestamps/status.
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
    const url = this.config.get<string>('DATABASE_URL');
    if (!url) throw new Error('DATABASE_URL not configured');

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
      const dump = await this.pgDump(url);
      const gzipped = await gzipP(dump);
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
        `Backup ${id} succeeded — ${(gzipped.length / 1024 / 1024).toFixed(2)} MB`,
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
   * Spawn pg_dump and capture stdout into a Buffer. Streams stderr to the
   * logger prefix only on failure (success case is chatty).
   */
  private pgDump(connectionString: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--compress=6',
          connectionString,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
      child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              'pg_dump binary not found. Install postgresql-client (Dockerfile already does this in production).',
            ),
          );
          return;
        }
        reject(err);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
          reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        resolve(Buffer.concat(stdoutChunks));
      });
    });
  }
}
