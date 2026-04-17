/**
 * One-shot: stuff a file into branding_assets by slug.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx src/db/upload-branding-asset.ts \
 *     <slug> <mime> <path>
 *
 * Example:
 *   tsx src/db/upload-branding-asset.ts favicon image/jpeg "E:\Fav Icon\AGC Fav Icon.jpg"
 */

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

async function main() {
  const slug = process.argv[2];
  const mime = process.argv[3];
  const path = process.argv[4];
  if (!slug || !mime || !path) {
    console.error('Usage: tsx upload-branding-asset.ts <slug> <mime> <path>');
    process.exit(2);
  }
  if (!['logo', 'favicon'].includes(slug)) {
    console.error(`slug must be 'logo' or 'favicon'`);
    process.exit(2);
  }

  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) {
    console.error('Set DATABASE_URL.');
    process.exit(2);
  }

  const bytes = await fs.readFile(path);
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      }),
    }),
  });

  try {
    await db
      .insertInto('branding_assets')
      .values({ slug, mime, bytes })
      .onConflict((oc) =>
        oc.column('slug').doUpdateSet({
          mime,
          bytes,
          updated_at: new Date(),
        }),
      )
      .execute();
    console.log(`✓ Stored ${slug} (${bytes.length} bytes, ${mime})`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
