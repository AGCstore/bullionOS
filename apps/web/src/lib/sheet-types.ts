/**
 * Shape of a row returned by GET /admin/products/sheet.
 * Shared between the in-stock and what-we-pay pages so both reuse one
 * React-Query cache key.
 */
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
  quantity_on_hand: number;
  quantity_reserved: number;
  available: number;
}
