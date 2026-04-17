/* eslint-disable no-console */
import 'dotenv/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from './types';

const PRODUCTS = [
  // Gold
  { sku: 'AU-EAGLE-1OZ', name: '1 oz American Gold Eagle', metal: 'gold', category: 'coin', weight: 1.0909, purity: 0.9167 },
  { sku: 'AU-BUFFALO-1OZ', name: '1 oz American Gold Buffalo', metal: 'gold', category: 'coin', weight: 1.0, purity: 0.9999 },
  { sku: 'AU-MAPLE-1OZ', name: '1 oz Canadian Gold Maple Leaf', metal: 'gold', category: 'coin', weight: 1.0, purity: 0.9999 },
  { sku: 'AU-BAR-10OZ', name: '10 oz Gold Bar (.9999)', metal: 'gold', category: 'bar', weight: 10, purity: 0.9999 },
  { sku: 'AU-BAR-1OZ', name: '1 oz Gold Bar (.9999)', metal: 'gold', category: 'bar', weight: 1.0, purity: 0.9999 },

  // Silver
  { sku: 'AG-EAGLE-1OZ', name: '1 oz American Silver Eagle', metal: 'silver', category: 'coin', weight: 1.0, purity: 0.999 },
  { sku: 'AG-MAPLE-1OZ', name: '1 oz Canadian Silver Maple Leaf', metal: 'silver', category: 'coin', weight: 1.0, purity: 0.9999 },
  { sku: 'AG-BAR-10OZ', name: '10 oz Silver Bar (.999)', metal: 'silver', category: 'bar', weight: 10, purity: 0.999 },
  { sku: 'AG-BAR-100OZ', name: '100 oz Silver Bar (.999)', metal: 'silver', category: 'bar', weight: 100, purity: 0.999 },
  { sku: 'AG-ROUND-1OZ', name: '1 oz Silver Round (.999 generic)', metal: 'silver', category: 'round', weight: 1.0, purity: 0.999 },

  // Platinum
  { sku: 'PT-EAGLE-1OZ', name: '1 oz American Platinum Eagle', metal: 'platinum', category: 'coin', weight: 1.0, purity: 0.9995 },

  // Palladium
  { sku: 'PD-MAPLE-1OZ', name: '1 oz Canadian Palladium Maple Leaf', metal: 'palladium', category: 'coin', weight: 1.0, purity: 0.9995 },
] as const;

// Default spreads per metal. Buy = discount to spot (client sells to us).
// Sell = premium over spot (client buys from us). Values are percent.
const METAL_DEFAULTS = [
  { metal: 'gold',      buy_pct: -3, sell_pct: 4 },
  { metal: 'silver',    buy_pct: -10, sell_pct: 15 },
  { metal: 'platinum',  buy_pct: -8, sell_pct: 8 },
  { metal: 'palladium', buy_pct: -10, sell_pct: 10 },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }),
  });

  console.log('Seeding products…');
  for (const p of PRODUCTS) {
    const content = p.weight * p.purity;
    await db
      .insertInto('products')
      .values({
        sku: p.sku,
        name: p.name,
        metal: p.metal,
        category: p.category,
        weight_troy_oz: p.weight.toFixed(8),
        purity: p.purity.toFixed(8),
        metal_content_troy_oz: content.toFixed(8),
        is_active: true,
        show_on_website: true,
      })
      .onConflict((oc) => oc.column('sku').doNothing())
      .execute();
  }
  const productCount = await db.selectFrom('products').select(db.fn.countAll<string>().as('c')).executeTakeFirstOrThrow();
  console.log(`  ✓ ${productCount.c} products in catalog`);

  console.log('Seeding metal-default pricing rules…');
  for (const m of METAL_DEFAULTS) {
    // Upsert: deactivate old active rule for this metal, insert new one.
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('pricing_rules')
        .set({ is_active: false, effective_until: new Date() })
        .where('scope', '=', 'metal')
        .where('metal', '=', m.metal)
        .where('is_active', '=', true)
        .execute();

      await trx
        .insertInto('pricing_rules')
        .values({
          scope: 'metal',
          metal: m.metal,
          buy_premium_type: 'percent',
          buy_premium_value: m.buy_pct.toFixed(8),
          sell_premium_type: 'percent',
          sell_premium_value: m.sell_pct.toFixed(8),
          is_active: true,
        })
        .execute();
    });
  }
  console.log(`  ✓ ${METAL_DEFAULTS.length} metal defaults active`);

  await db.destroy();
  console.log('\nTrading seed complete.');
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
