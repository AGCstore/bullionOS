// Pricing math verified in isolation. We stub Kysely and MetalsService so
// the tests exercise ONLY PricingService's math + rule-resolution logic.
//
// What we're asserting:
//   * product override beats metal default
//   * metal default used when no override
//   * percent vs flat premium math matches the documented formula
//   * quantity scales line totals correctly
//   * decimals survive: no JS float drift creeps in
import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { PricingService } from '../../src/pricing/pricing.service';
import type { DB, Metal, PremiumType } from '../../src/db/types';
import type { MetalsService } from '../../src/metals/metals.service';
import { d } from '../../src/common/money';

// ─── fixtures ────────────────────────────────────────────────────────

const GOLD_EAGLE = {
  id: 'p-gold-eagle',
  name: '1 oz Gold Eagle',
  metal: 'gold' as Metal,
  weight_troy_oz: '1.0909',
  purity: '0.9167',
  metal_content_troy_oz: '1.00000003', // pre-computed
};
const SILVER_EAGLE = {
  id: 'p-silver-eagle',
  name: '1 oz Silver Eagle',
  metal: 'silver' as Metal,
  weight_troy_oz: '1.0',
  purity: '0.999',
  metal_content_troy_oz: '0.999',
};

const rule = (
  overrides: Partial<{
    id: string;
    scope: 'metal' | 'product';
    metal: Metal | null;
    product_id: string | null;
    buy_premium_type: PremiumType;
    buy_premium_value: string;
    sell_premium_type: PremiumType;
    sell_premium_value: string;
    is_active: boolean;
  }> = {},
) => ({
  id: 'r-default',
  scope: 'metal' as const,
  metal: 'gold' as Metal | null,
  product_id: null as string | null,
  buy_premium_type: 'percent' as PremiumType,
  buy_premium_value: '-3',
  sell_premium_type: 'percent' as PremiumType,
  sell_premium_value: '4',
  is_active: true,
  ...overrides,
});

// Minimal Kysely test double: returns pre-baked rows per table.
function makeDbStub(opts: {
  products: typeof GOLD_EAGLE[];
  rules: ReturnType<typeof rule>[];
}): Kysely<DB> {
  const chain = (rows: unknown[]): unknown => ({
    select: () => chain(rows),
    selectAll: () => chain(rows),
    innerJoin: () => chain(rows),
    leftJoin: () => chain(rows),
    where: () => chain(rows),
    orderBy: () => chain(rows),
    groupBy: () => chain(rows),
    limit: () => chain(rows),
    execute: async () => rows,
    executeTakeFirst: async () => rows[0] ?? null,
    executeTakeFirstOrThrow: async () => {
      if (!rows[0]) throw new Error('no row');
      return rows[0];
    },
  });
  return {
    selectFrom: (table: string) => {
      if (table === 'products') return chain(opts.products) as never;
      if (table === 'pricing_rules' || table.startsWith('pricing_rules'))
        return chain(opts.rules) as never;
      return chain([]) as never;
    },
  } as unknown as Kysely<DB>;
}

function makeMetalsStub(spots: Partial<Record<Metal, string>>): MetalsService {
  return {
    getSpot: async () => ({ ...(spots as Record<Metal, string>), asOf: '', cachedAt: 0 }),
    getSpotFor: async (m: Metal) => {
      const v = spots[m];
      if (!v) throw new Error(`no spot for ${m}`);
      return v;
    },
  } as unknown as MetalsService;
}

// ─── tests ───────────────────────────────────────────────────────────

describe('PricingService — rule resolution', () => {
  it('uses product override when one exists, ignoring the metal default', async () => {
    const db = makeDbStub({
      products: [GOLD_EAGLE],
      rules: [
        rule({ scope: 'product', product_id: GOLD_EAGLE.id, metal: null, buy_premium_value: '99', id: 'override' }),
      ],
    });
    // Stub: resolveRule reads product overrides first, returns the first one.
    const svc = new PricingService(db, makeMetalsStub({ gold: '2000' }));
    const r = await svc.resolveRule({ id: GOLD_EAGLE.id, metal: 'gold' });
    expect(r.source).toBe('product');
    expect(r.rule_id).toBe('override');
    expect(r.buy_premium_value).toBe('99');
  });

  it('falls back to metal default when no product override', async () => {
    const db = makeDbStub({
      products: [GOLD_EAGLE],
      // Only metal-scope rule — no product override.
      // Need to reject on first .executeTakeFirst() for the override query.
      rules: [],
    });
    // Override this stub: we need the first query (product override) to miss,
    // second query (metal default) to hit. Use a sequenced stub.
    let call = 0;
    const sequenced = {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              where: () => ({
                executeTakeFirst: async () => {
                  call++;
                  return call === 1 ? undefined : rule({ id: 'metal-default', metal: 'gold' });
                },
              }),
            }),
          }),
        }),
      }),
    } as unknown as Kysely<DB>;
    const svc = new PricingService(sequenced, makeMetalsStub({ gold: '2000' }));
    const r = await svc.resolveRule({ id: GOLD_EAGLE.id, metal: 'gold' });
    expect(r.source).toBe('metal');
    expect(r.rule_id).toBe('metal-default');
  });

  it('returns 0% fallback when no rule exists at all', async () => {
    const alwaysMiss = {
      selectFrom: () => ({
        selectAll: () => ({
          where: () => ({
            where: () => ({
              where: () => ({ executeTakeFirst: async () => undefined }),
            }),
          }),
        }),
      }),
    } as unknown as Kysely<DB>;
    const svc = new PricingService(alwaysMiss, makeMetalsStub({ gold: '2000' }));
    const r = await svc.resolveRule({ id: GOLD_EAGLE.id, metal: 'gold' });
    expect(r.source).toBe('none');
    expect(r.buy_premium_value).toBe('0');
    expect(r.sell_premium_value).toBe('0');
  });
});

describe('PricingService — percent premium', () => {
  // melt = 2000 * 0.999 = 1998
  // buy  = 1998 * (1 - 10/100) = 1798.20
  // sell = 1998 * (1 + 15/100) = 2297.70
  it('computes buy/sell from percent premiums', async () => {
    const db = makeDbStub({
      products: [SILVER_EAGLE],
      rules: [
        rule({
          metal: 'silver',
          buy_premium_type: 'percent',
          buy_premium_value: '-10',
          sell_premium_type: 'percent',
          sell_premium_value: '15',
        }),
      ],
    });
    const svc = new PricingService(db, makeMetalsStub({ silver: '2000' }));
    const [q] = await svc.quoteMany([{ product_id: SILVER_EAGLE.id, quantity: 1 }]);
    expect(q.melt_value_per_unit).toBe(d('2000').times('0.999').toFixed(8));
    expect(q.buy_unit_price).toBe(d('1998').times('0.9').toFixed(8));
    expect(q.sell_unit_price).toBe(d('1998').times('1.15').toFixed(8));
  });
});

describe('PricingService — flat premium', () => {
  // flat is dollars PER TROY OUNCE OF METAL CONTENT.
  // melt = 2000 * 0.999 = 1998
  // buy  = melt + (-1 * 0.999)  = 1997.001
  // sell = melt + ( 3 * 0.999)  = 2000.997
  it('scales flat premium by metal content', async () => {
    const db = makeDbStub({
      products: [SILVER_EAGLE],
      rules: [
        rule({
          metal: 'silver',
          buy_premium_type: 'flat',
          buy_premium_value: '-1',
          sell_premium_type: 'flat',
          sell_premium_value: '3',
        }),
      ],
    });
    const svc = new PricingService(db, makeMetalsStub({ silver: '2000' }));
    const [q] = await svc.quoteMany([{ product_id: SILVER_EAGLE.id, quantity: 1 }]);
    const melt = d('2000').times('0.999');
    expect(q.buy_unit_price).toBe(melt.plus(d('-1').times('0.999')).toFixed(8));
    expect(q.sell_unit_price).toBe(melt.plus(d('3').times('0.999')).toFixed(8));
  });
});

describe('PricingService — line totals and snapshot fields', () => {
  it('scales line totals by quantity and exposes gross+purity separately', async () => {
    const db = makeDbStub({
      products: [SILVER_EAGLE],
      rules: [rule({ metal: 'silver', buy_premium_value: '-5', sell_premium_value: '10' })],
    });
    const svc = new PricingService(db, makeMetalsStub({ silver: '2000' }));
    const [q] = await svc.quoteMany([{ product_id: SILVER_EAGLE.id, quantity: 7 }]);
    // Snapshot fields must be present + distinct.
    expect(q.product_weight_troy_oz).toBe('1.00000000');
    expect(q.product_purity).toBe('0.99900000');
    expect(q.metal_content_per_unit).toBe('0.99900000');
    // Line totals
    const meltPerUnit = d('2000').times('0.999');
    const buyPerUnit = meltPerUnit.times('0.95');
    expect(q.buy_line_total).toBe(buyPerUnit.times(7).toFixed(8));
  });
});
