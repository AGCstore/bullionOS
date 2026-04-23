/**
 * Shape of a row returned by GET /admin/products/sheet.
 * Shared between the in-stock and what-we-pay pages so both reuse one
 * React-Query cache key.
 */
export type PremiumType = 'percent' | 'flat';

export interface SheetRow {
  product_id: string;
  sku: string;
  name: string;
  metal: string;
  category: string;
  show_on_website: boolean;
  weight_troy_oz: string;
  purity: string;
  /** Operator-set manual order from the drag-to-reorder UI (any page). */
  sort_order: number;
  /** Operator-set pin; empty/null means use the heuristic. */
  display_category_override: string | null;
  buy_price: string | null;
  sell_price: string | null;
  /**
   * Stored premium (rule) values — used by the Price Sheet to render
   * the "% of spot" / "$ over spot" subtitles without re-deriving from
   * the rounded unit price. For `percent` type the value is SHARE-form
   * (e.g. "96" = 96% of melt). For `flat` it is $/troy-oz-of-metal-
   * content. Null when no pricing rule is configured.
   */
  buy_premium_type: PremiumType | null;
  buy_premium_value: string | null;
  sell_premium_type: PremiumType | null;
  sell_premium_value: string | null;
  /** Per-unit metal content (weight × purity) — stable snapshot value. */
  metal_content_troy_oz: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  available: number;
  /** Physical storage label — 'main' by default. Editable on Catalog. */
  location: string;
}
