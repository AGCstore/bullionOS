/**
 * One-shot admin tool: bump an existing user's role.
 *
 * Usage (from repo root):
 *   pnpm --filter @agc/api exec tsx src/db/set-role.ts <email> <role>
 *
 * Against Railway:
 *   railway run --service agc-api pnpm --filter @agc/api exec tsx src/db/set-role.ts trubeesvault@gmail.com admin
 *
 * Roles: admin | staff | client
 *
 * What it does:
 *   1. Looks up the user by email (case-insensitive)
 *   2. Updates role + sets status=active so they can log in immediately
 *   3. Prints the before/after row
 *
 * What it does NOT do:
 *   - Create the user if they don't exist (by design — avoids handing out
 *     admin to a typo). The user must register via /register first; then
 *     run this script to promote them.
 *   - Change passwords, clear 2FA, or revoke sessions. If the target is
 *     already logged in, the next token refresh picks up the new role.
 */

import 'dotenv/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3]?.trim().toLowerCase() as
    | 'admin'
    | 'staff'
    | 'client'
    | undefined;

  if (!email || !role) {
    console.error(
      'Usage: tsx src/db/set-role.ts <email> <admin|staff|client>',
    );
    process.exit(2);
  }
  if (!['admin', 'staff', 'client'].includes(role)) {
    console.error(`Unknown role '${role}'. Use admin | staff | client.`);
    process.exit(2);
  }

  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) {
    console.error('Set DATABASE_URL (or DATABASE_PUBLIC_URL).');
    process.exit(2);
  }

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString, ssl: { rejectUnauthorized: false } }),
    }),
  });

  try {
    const before = await db
      .selectFrom('users')
      .select(['id', 'email', 'role', 'status'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (!before) {
      console.error(
        `No user with email ${email}. They must register at /register first — then re-run this script to promote them.`,
      );
      process.exit(1);
    }

    if (before.role === role && before.status === 'active') {
      console.log(
        `${email} is already ${role} · active. Nothing to do.`,
      );
      process.exit(0);
    }

    await db
      .updateTable('users')
      .where('id', '=', before.id)
      .set({ role, status: 'active' })
      .execute();

    console.log(
      `✓ ${email}: role ${before.role} → ${role}, status ${before.status} → active`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
