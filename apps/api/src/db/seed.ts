/* eslint-disable no-console */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

/**
 * Seeds a default admin + one walk-in client.
 *
 * IMPORTANT: the default admin password below is for local dev only.
 * Rotate it immediately in any non-local environment.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }),
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@agc.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe_Admin_123!';

  const existing = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', adminEmail)
    .executeTakeFirst();

  if (existing) {
    console.log(`Admin ${adminEmail} already exists (id=${existing.id}). Skipping.`);
  } else {
    const hash = await bcrypt.hash(adminPassword, Number(process.env.BCRYPT_COST ?? 12));
    const admin = await db
      .insertInto('users')
      .values({
        email: adminEmail,
        password_hash: hash,
        role: 'admin',
        status: 'active',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    console.log(`✓ Created admin ${adminEmail} (id=${admin.id})`);
    console.log(`  Password: ${adminPassword}`);
    console.log(`  >>> CHANGE THIS PASSWORD IMMEDIATELY <<<`);
  }

  const walkIn = await db
    .selectFrom('clients')
    .select('id')
    .where('email', '=', 'walkin.sample@agc.local')
    .executeTakeFirst();
  if (!walkIn) {
    await db
      .insertInto('clients')
      .values({
        first_name: 'Walk-In',
        last_name: 'Sample',
        email: 'walkin.sample@agc.local',
        phone: '+1-555-0100',
        is_portal_enabled: false,
      })
      .execute();
    console.log(`✓ Created sample walk-in client`);
  }

  await db.destroy();
  console.log('\nSeed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
