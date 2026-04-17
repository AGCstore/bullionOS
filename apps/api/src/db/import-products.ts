/**
 * One-shot product import. Handles the AGC product-list CSV shape, which
 * is fiddly:
 *   - Each data row is wrapped in outer double-quotes (whole row = 1 CSV field).
 *   - Lines starting with `#` are section comments. Skip.
 *   - Blank lines between groups. Skip.
 *   - No `purity` column — we infer a sensible default per metal + category
 *     (gold coins 0.9167 unless Eagle/Maple noted as 0.9999, silver coins
 *     0.999, junk silver 0.9, etc.) and the operator can fine-tune later
 *     from /admin/products.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx src/db/import-products.ts <path>
 *
 * Idempotent: rows keyed by SKU. Existing SKUs are left alone (no overwrite).
 */

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { DB, Metal, ProductCategory } from './types';

interface Row {
  sku: string;
  metal: Metal;
  category: ProductCategory;
  item_name: string;
  weight_troy_oz: string;
  purity: string;
}

/**
 * Purity defaults by metal + item name/category. These are ballparks for
 * US retail bullion catalogues; the operator edits exact values after
 * import if needed.
 */
function inferPurity(metal: Metal, name: string, category: string): string {
  const n = name.toLowerCase();
  if (metal === 'gold') {
    // Most common sovereign bullion is 0.9999 today; Eagles are 0.9167
    // (alloyed to 22k for durability).
    if (/\beagle\b/.test(n) && !/\bburnished\b/.test(n)) return '0.9167';
    if (/\bkrugerrand\b/.test(n)) return '0.9167';
    return '0.9999';
  }
  if (metal === 'silver') {
    if (category === 'junk_silver' || /\bjunk\b|90%/.test(n)) return '0.9';
    if (/\b40%\b/.test(n)) return '0.4';
    if (/\b35%\b/.test(n)) return '0.35';
    return '0.999';
  }
  if (metal === 'platinum' || metal === 'palladium') return '0.9995';
  return '1';
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx import-products.ts <csv path>');
    process.exit(2);
  }
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) {
    console.error('Set DATABASE_URL.');
    process.exit(2);
  }

  const raw = await fs.readFile(path, 'utf8');
  const rows = parseAgcCsv(raw);
  if (rows.length === 0) {
    console.error('No rows parsed.');
    process.exit(1);
  }

  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      }),
    }),
  });

  let inserted = 0;
  let skipped = 0;
  const skippedSkus: string[] = [];

  try {
    for (const r of rows) {
      const existing = await db
        .selectFrom('products')
        .select('id')
        .where('sku', '=', r.sku)
        .executeTakeFirst();
      if (existing) {
        skipped++;
        skippedSkus.push(r.sku);
        continue;
      }
      // Content = gross weight × purity. The invoice snapshot + pricing
      // service both compute buy/sell against this number, so we have to
      // store it explicitly on the product row.
      const content = (Number(r.weight_troy_oz) * Number(r.purity)).toFixed(8);
      await db
        .insertInto('products')
        .values({
          sku: r.sku,
          name: r.item_name,
          metal: r.metal,
          category: r.category,
          weight_troy_oz: r.weight_troy_oz,
          purity: r.purity,
          metal_content_troy_oz: content,
          is_active: true,
          show_on_website: true,
        })
        .execute();
      inserted++;
    }
  } finally {
    await db.destroy();
  }

  console.log(`✓ Product import complete`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (SKU already exists): ${skipped}`);
  if (skippedSkus.length) {
    console.log(
      `    · ${skippedSkus.slice(0, 20).join(', ')}${skippedSkus.length > 20 ? '…' : ''}`,
    );
  }
  console.log(`  Total rows seen: ${rows.length}`);
}

/**
 * Parse the AGC list format. Each row arrives as a single CSV field wrapped
 * in quotes; after stripping the wrap we split on commas normally.
 */
function parseAgcCsv(text: string): Row[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const rows: Row[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // First line is the header (also quoted in this file).
    if (/^"?sku,metal,category,item_name/i.test(line)) continue;

    // Strip outer quotes if present.
    let inner = line;
    if (inner.startsWith('"') && inner.endsWith('"')) {
      inner = inner.slice(1, -1);
    }
    const parts = inner.split(',').map((s) => s.trim());
    if (parts.length < 5) continue;
    const [sku, metal, category, item_name, weight] = parts;
    if (!sku || !metal || !category || !item_name || !weight) continue;
    rows.push({
      sku: sku.toUpperCase(),
      metal: metal.toLowerCase() as Metal,
      // CSV categories are domain-level (gold_coin / foreign_silver /
      // junk_silver / …). The schema's CHECK constraint enforces a smaller
      // surface (coin / bar / round / numismatic / jewelry / other). Map
      // on the way in so inserts don't violate the constraint.
      category: mapCategory(item_name, category),
      item_name,
      weight_troy_oz: weight,
      purity: inferPurity(metal.toLowerCase() as Metal, item_name, category),
    });
  }
  return rows;
}

function mapCategory(name: string, raw: string): ProductCategory {
  const n = name.toLowerCase();
  const r = raw.toLowerCase();
  if (n.includes(' bar ') || n.endsWith(' bar') || r.includes('bar')) return 'bar';
  if (n.includes(' round') || r.includes('round')) return 'round';
  if (n.includes('jewel') || r.includes('jewel')) return 'jewelry';
  if (r.includes('numismatic')) return 'numismatic';
  return 'coin';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
