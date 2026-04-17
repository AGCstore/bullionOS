/* eslint-disable no-console */
import 'dotenv/config';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Kysely, Migrator, FileMigrationProvider, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

async function getDb(): Promise<Kysely<DB>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 4 }) }),
  });
}

function getMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(__dirname, 'migrations'),
    }),
  });
}

async function run() {
  const direction = process.argv[2] ?? 'up';
  const db = await getDb();
  const migrator = getMigrator(db);

  const { error, results } =
    direction === 'down'
      ? await migrator.migrateDown()
      : await migrator.migrateToLatest();

  for (const r of results ?? []) {
    if (r.status === 'Success') {
      console.log(`  ✓ ${direction} ${r.migrationName}`);
    } else if (r.status === 'Error') {
      console.error(`  ✗ failed ${r.migrationName}`);
    }
  }

  if (error) {
    console.error('\nMigration failed:', error);
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
