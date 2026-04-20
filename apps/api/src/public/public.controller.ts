import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ProductsService } from '../products/products.service';
import { PricingService } from '../pricing/pricing.service';
import { MetalsService } from '../metals/metals.service';
import { toDisplay } from '../common/money';
import { PublicCacheService } from './public-cache.service';

interface WhatWePayRow {
  product_id: string;
  sku: string;
  name: string;
  metal: string;
  category: string;
  weight_troy_oz: string;
  purity: string;
  buy_price: string; // what we pay per unit
  image_url: string | null;
}

interface WhatWePayResponse {
  items: WhatWePayRow[];
  as_of: string;
}

// TTL for the what-we-pay cache. Slightly larger than the metals cache (30s)
// is fine — the feed is read far more than it's written to, and never used
// for transactional decisions (those always hit pricing.quote() fresh).
const WHAT_WE_PAY_TTL_SEC = 30;

@Controller('public')
export class PublicController {
  constructor(
    private readonly products: ProductsService,
    private readonly pricing: PricingService,
    private readonly metals: MetalsService,
    private readonly cache: PublicCacheService,
  ) {}

  /** Public spot — displayed on landing pages, no auth. */
  @Public()
  @Get('spot')
  async spot() {
    const s = await this.metals.getSpot();
    return {
      gold: toDisplay(s.gold, 2),
      silver: toDisplay(s.silver, 2),
      platinum: toDisplay(s.platinum, 2),
      palladium: toDisplay(s.palladium, 2),
      change: s.change ?? null,
      as_of: s.asOf,
    };
  }

  /** Public product list — only items flagged show_on_website. */
  @Public()
  @Get('products')
  async listProducts() {
    const rows = await this.products.list({ onlyActive: true, onlyWebsite: true });
    return rows.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      metal: p.metal,
      category: p.category,
      weight_troy_oz: p.weight_troy_oz,
      purity: p.purity,
      image_url: p.image_url,
    }));
  }

  /**
   * "What we pay" feed — BUY prices for website-visible products.
   *
   * Hot path:
   *   1. Try Redis cache.
   *   2. On miss, batch-quote all visible products in one pass:
   *        1 SELECT products (IN list)
   *        1 SELECT product rule overrides
   *        1 SELECT metal defaults (distinct metals, IN list)
   *        1 spot-read per distinct metal (Redis-cached upstream)
   *      Total ~5 queries regardless of product count (was N+1).
   *   3. Cache the response for WHAT_WE_PAY_TTL_SEC.
   *
   * Invalidation: Products/PricingRules services call
   *   PublicCacheService.invalidatePricingDependent() on mutation.
   * TTL is a backstop if a mutation path forgets to invalidate.
   */
  @Public()
  @Get('what-we-pay')
  // No-store at the HTTP layer so Fastly/Railway edge can't pile another
  // cache on top of our 30s Redis cache. Without this, a toggle on AGC
  // Desk could take Fastly TTL + Redis TTL + WP transient + browser
  // poll to appear on atlantagoldandcoin.com — cascading caches that
  // add up to minutes.
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async whatWePay(): Promise<WhatWePayResponse> {
    const cached = await this.cache.get<WhatWePayResponse>(
      PublicCacheService.KEY_WHAT_WE_PAY,
    );
    if (cached) return cached;

    const products = await this.products.list({ onlyActive: true, onlyWebsite: true });
    if (products.length === 0) {
      const empty: WhatWePayResponse = { items: [], as_of: new Date().toISOString() };
      await this.cache.set(PublicCacheService.KEY_WHAT_WE_PAY, empty, WHAT_WE_PAY_TTL_SEC);
      return empty;
    }

    const spot = await this.metals.getSpot();
    const quotes = await this.pricing.quoteMany(
      products.map((p) => ({ product_id: p.id, quantity: 1 })),
    );
    const quoteByProduct = new Map(quotes.map((q) => [q.product_id, q]));

    const items: WhatWePayRow[] = products
      .map((p): WhatWePayRow | null => {
        const q = quoteByProduct.get(p.id);
        if (!q) return null;
        return {
          product_id: p.id,
          sku: p.sku,
          name: p.name,
          metal: p.metal,
          category: p.category,
          weight_troy_oz: p.weight_troy_oz,
          purity: p.purity,
          buy_price: toDisplay(q.buy_unit_price, 2),
          image_url: p.image_url,
        };
      })
      .filter((r): r is WhatWePayRow => r !== null);

    const body: WhatWePayResponse = { items, as_of: spot.asOf };
    await this.cache.set(PublicCacheService.KEY_WHAT_WE_PAY, body, WHAT_WE_PAY_TTL_SEC);
    return body;
  }
}
