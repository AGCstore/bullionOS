import type { ReactNode } from 'react';

/**
 * Wraps a page's content in a subtle side-specific background.
 *  - `buy`  → navy tint (money going OUT: what-we-pay, buy invoices)
 *  - `sell` → green tint (money coming IN: sell invoices, inventory)
 *
 * The tint is a full-bleed background behind the existing content so the
 * cards/tables retain their white surface and stay readable. This only
 * affects the on-screen view; invoice PDFs are rendered separately and
 * remain monochrome.
 */
export function PageTint({
  side,
  children,
}: {
  side: 'buy' | 'sell';
  children: ReactNode;
}) {
  const bg = side === 'buy' ? 'bg-buy-50' : 'bg-sell-50';
  // Cancels out the parent <main>'s `px-6 py-6 md:px-10` so the tint
  // reaches edge-to-edge, then reapplies the same padding inside.
  return (
    <div
      className={`${bg} -mx-6 -my-6 min-h-[calc(100vh-3.5rem)] px-6 py-6 md:-mx-10 md:px-10`}
    >
      {children}
    </div>
  );
}
