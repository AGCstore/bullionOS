import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ProductsService } from '../products/products.service';
import { PricingService } from '../pricing/pricing.service';
import { MetalsService } from '../metals/metals.service';
import { toDisplay } from '../common/money';

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

@Controller('public')
export class PublicController {
  constructor(
    private readonly products: ProductsService,
    private readonly pricing: PricingService,
    private readonly metals: MetalsService,
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
   * Clients/public see only the buy side; sell prices are gated behind admin.
   */
  @Public()
  @Get('what-we-pay')
  async whatWePay(): Promise<{ items: WhatWePayRow[]; as_of: string }> {
    const products = await this.products.list({ onlyActive: true, onlyWebsite: true });
    const spot = await this.metals.getSpot();

    const items = await Promise.all(
      products.map(async (p): Promise<WhatWePayRow> => {
        const q = await this.pricing.quote(p.id, 1);
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
      }),
    );

    return { items, as_of: spot.asOf };
  }
}
