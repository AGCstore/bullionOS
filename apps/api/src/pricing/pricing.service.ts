import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, Metal, PremiumType, Product } from '../db/types';
import { MetalsService } from '../metals/metals.service';
import { d, toDbString, Decimal } from '../common/money';

export interface ResolvedRule {
  buy_premium_type: PremiumType;
  buy_premium_value: string;
  sell_premium_type: PremiumType;
  sell_premium_value: string;
  /** 'metal' (default) or 'product' (override). Useful for explainability. */
  source: 'metal' | 'product' | 'none';
  rule_id: string | null;
}

export interface PriceQuote {
  product_id: string;
  product_name: string;
  metal: Metal;
  quantity: number;

  spot_per_oz: string;
  metal_content_per_unit: string;
  melt_value_per_unit: string;

  buy_unit_price: string;
  buy_line_total: string;
  buy_premium_type: PremiumType;
  buy_premium_value: string;

  sell_unit_price: string;
  sell_line_total: string;
  sell_premium_type: PremiumType;
  sell_premium_value: string;

  computed_at: string;
  source: 'metal' | 'product' | 'none';
  rule_id: string | null;
}

/**
 * Pricing engine.
 *
 * Resolution order per product:
 *  1. Active product override  (pricing_rules.scope='product', product_id=X, is_active=true)
 *  2. Active metal default      (pricing_rules.scope='metal',   metal=P.metal, is_active=true)
 *  3. Hard fallback: 0% premium (returns melt value; flagged source='none')
 *
 * Math:
 *   melt           = spot_per_oz * metal_content_per_unit
 *   buy_per_unit   = premium_type='percent' ? melt * (1 + pct/100) : melt + (flat_per_oz * metal_content_per_unit)
 *   sell_per_unit  = same formula with sell_premium
 *
 * NOTE: 'flat' premium is dollars-per-troy-oz-of-metal-content, so a "flat" premium
 * on a 1oz Gold Eagle and a 10oz gold bar scales correctly with metal content.
 * This is how precious-metals dealers typically quote flat-over-spot premiums.
 */
@Injectable()
export class PricingService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly metals: MetalsService,
  ) {}

  async resolveRule(product: Pick<Product, 'id' | 'metal'>): Promise<ResolvedRule> {
    // Product override first.
    const override = await this.db
      .selectFrom('pricing_rules')
      .selectAll()
      .where('scope', '=', 'product')
      .where('product_id', '=', product.id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (override) {
      return {
        buy_premium_type: override.buy_premium_type,
        buy_premium_value: override.buy_premium_value,
        sell_premium_type: override.sell_premium_type,
        sell_premium_value: override.sell_premium_value,
        source: 'product',
        rule_id: override.id,
      };
    }

    const metalDefault = await this.db
      .selectFrom('pricing_rules')
      .selectAll()
      .where('scope', '=', 'metal')
      .where('metal', '=', product.metal)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (metalDefault) {
      return {
        buy_premium_type: metalDefault.buy_premium_type,
        buy_premium_value: metalDefault.buy_premium_value,
        sell_premium_type: metalDefault.sell_premium_type,
        sell_premium_value: metalDefault.sell_premium_value,
        source: 'metal',
        rule_id: metalDefault.id,
      };
    }

    return {
      buy_premium_type: 'percent',
      buy_premium_value: '0',
      sell_premium_type: 'percent',
      sell_premium_value: '0',
      source: 'none',
      rule_id: null,
    };
  }

  /** Compute buy + sell price for a given product/quantity using current spot. */
  async quote(productId: string, quantity = 1): Promise<PriceQuote> {
    if (quantity <= 0) throw new Error('quantity must be positive');

    const product = await this.db
      .selectFrom('products')
      .select([
        'id',
        'name',
        'metal',
        'weight_troy_oz',
        'purity',
        'metal_content_troy_oz',
      ])
      .where('id', '=', productId)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!product) throw new NotFoundException('Product not found or inactive');

    const spot = await this.metals.getSpotFor(product.metal);
    const rule = await this.resolveRule({ id: product.id, metal: product.metal });

    const content = d(product.metal_content_troy_oz);
    const melt = d(spot).times(content);

    const buyUnit = this.applyPremium(melt, content, rule.buy_premium_type, rule.buy_premium_value);
    const sellUnit = this.applyPremium(melt, content, rule.sell_premium_type, rule.sell_premium_value);

    const qty = d(quantity);

    return {
      product_id: product.id,
      product_name: product.name,
      metal: product.metal,
      quantity,

      spot_per_oz: toDbString(spot),
      metal_content_per_unit: toDbString(content),
      melt_value_per_unit: toDbString(melt),

      buy_unit_price: toDbString(buyUnit),
      buy_line_total: toDbString(buyUnit.times(qty)),
      buy_premium_type: rule.buy_premium_type,
      buy_premium_value: rule.buy_premium_value,

      sell_unit_price: toDbString(sellUnit),
      sell_line_total: toDbString(sellUnit.times(qty)),
      sell_premium_type: rule.sell_premium_type,
      sell_premium_value: rule.sell_premium_value,

      computed_at: new Date().toISOString(),
      source: rule.source,
      rule_id: rule.rule_id,
    };
  }

  /**
   * Apply a premium to melt value.
   *
   *  percent → melt * (1 + pct/100)
   *  flat    → melt + (flat_per_oz * metal_content)
   */
  private applyPremium(
    melt: Decimal,
    metalContent: Decimal,
    type: PremiumType,
    value: string,
  ): Decimal {
    const v = d(value);
    if (type === 'percent') {
      return melt.times(d(1).plus(v.div(100)));
    }
    return melt.plus(v.times(metalContent));
  }
}
