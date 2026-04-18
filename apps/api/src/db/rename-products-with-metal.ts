/**
 * One-shot: insert the metal word into every product name that doesn't
 * already contain one. Turns "American Eagle - 1 oz" into "American Gold
 * Eagle - 1 oz" for gold rows, "American Silver Eagle - 1 oz" for silver
 * rows, etc.
 *
 * Placement rule:
 *   - If the metal word (Gold / Silver / Platinum / Palladium) already
 *     appears anywhere in the name (case-insensitive), skip.
 *   - Else insert it as the second word when the name starts with a
 *     single-word country/nationality/adjective ("American Eagle",
 *     "Canadian Maple Leaf", "South African Krugerrand" — this last one
 *     becomes "South African Gold Krugerrand" because we detect the
 *     "South African" compound and insert after it).
 *   - Else prepend: "$20 St. Gaudens" → "$20 Gold St. Gaudens" (metal
 *     slotted before the numismatic identifier).
 *
 * Idempotent — running twice is a no-op because the second pass sees
 * the metal word already in the name and skips.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx src/db/rename-products-with-metal.ts
 *
 * Dry-run (prints what it WOULD change without writing):
 *   DRY_RUN=1 DATABASE_URL=... pnpm exec tsx src/db/rename-products-with-metal.ts
 */

import 'dotenv/config';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB, Metal } from './types';

const METAL_WORD: Record<Metal, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  palladium: 'Palladium',
};

/**
 * Words that form compound country/nationality prefixes we should slot
 * the metal AFTER — "South African" must stay intact rather than getting
 * "South Gold African Krugerrand". Compound length is 2 words.
 */
const COMPOUND_NATIONALITIES = new Set(['south', 'great']);

/**
 * Single-word nationalities/adjectives where the metal fits naturally
 * in position 2 ("American Gold Eagle", "Canadian Silver Maple Leaf",
 * "Chinese Gold Panda", etc.). If the name's first word is in this
 * set, we inject at index 1.
 */
const NATIONALITY_WORDS = new Set([
  'american',
  'canadian',
  'chinese',
  'british',
  'australian',
  'austrian',
  'french',
  'mexican',
  'russian',
  'swiss',
  'generic',
]);

function injectMetal(name: string, metal: Metal): string {
  const metalWord = METAL_WORD[metal];
  const lower = name.toLowerCase();

  // Already labeled — leave alone.
  if (lower.includes(` ${metal}`) || lower.startsWith(`${metal} `)) return name;

  const parts = name.split(/\s+/);
  if (parts.length < 2) return `${metalWord} ${name}`;

  // Compound nationality at the front (e.g. "South African").
  if (
    parts.length >= 3 &&
    COMPOUND_NATIONALITIES.has(parts[0].toLowerCase())
  ) {
    return [parts[0], parts[1], metalWord, ...parts.slice(2)].join(' ');
  }

  // Single-word nationality at the front.
  if (NATIONALITY_WORDS.has(parts[0].toLowerCase())) {
    return [parts[0], metalWord, ...parts.slice(1)].join(' ');
  }

  // Fallback: prepend the metal so "$20 St. Gaudens Double Eagle"
  // becomes "$20 Gold St. Gaudens Double Eagle". A bit unusual but
  // unambiguous and searchable.
  return `${metalWord} ${name}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const dryRun = process.env.DRY_RUN === '1';
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: url,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      }),
    }),
  });

  const rows = await db
    .selectFrom('products')
    .select(['id', 'name', 'metal'])
    .orderBy('name')
    .execute();

  const changes: Array<{ id: string; from: string; to: string }> = [];
  for (const r of rows) {
    const next = injectMetal(r.name, r.metal as Metal);
    if (next !== r.name) changes.push({ id: r.id as string, from: r.name, to: next });
  }

  console.log(
    `${rows.length} products scanned · ${changes.length} need renaming` +
      (dryRun ? ' (dry run)' : ''),
  );
  for (const c of changes.slice(0, 20)) {
    console.log(`  · ${c.from}\n    → ${c.to}`);
  }
  if (changes.length > 20) console.log(`  …and ${changes.length - 20} more`);

  if (!dryRun) {
    for (const c of changes) {
      await db.updateTable('products').set({ name: c.to }).where('id', '=', c.id).execute();
    }
    console.log(`✓ Renamed ${changes.length} products.`);
  }
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
