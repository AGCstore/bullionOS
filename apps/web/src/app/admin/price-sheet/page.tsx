'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { SheetRow } from '@/lib/sheet-types';
import { rankProducts } from '@/lib/product-search';
import { useLiveSpot } from '@/lib/use-live-spot';

/**
 * Quick Reference Price Sheet.
 *
 * Single-surface cheat sheet for operators quoting at the counter —
 * every active product with its current buy + sell price, fuzzy
 * search at the top, and a tiny "X% of spot" line under each price
 * so the operator can sanity-check pricing without cross-referencing
 * the pricing-rules page.
 *
 * Design choices:
 *   - No drag reorder, no editing, no filters — this is read-only.
 *     The sheets that support editing live at /admin/in-stock-sheet
 *     and /admin/buy-sheet. This page is the "glance and quote" view.
 *   - Admin-only page (staff sees it too) — the % of spot is a
 *     margin signal, fine for the back-office but we don't surface it
 *     to clients. Client-facing pricing lives at /dashboard/pricing.
 */

type Metal = 'gold' | 'silver' | 'platinum' | 'palladium';

export default function PriceSheetPage() {
  const [search, setSearch] = useState('');
  const { spot } = useLiveSpot();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', 'sheet'],
    queryFn: () => apiFetch<SheetRow[]>('/admin/products/sheet'),
    refetchInterval: 60_000,
  });

  // Search across sku/name/metal. rankProducts returns rows as-is when
  // query is empty, so empty search = full catalog view sorted by
  // sort_order (server default).
  const filtered = useMemo(
    () => rankProducts(data ?? [], search),
    [data, search],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quick price sheet</h1>
          <p className="mt-1 text-sm text-ink-400">
            Live buy and sell prices side-by-side. Percentage under each
            number is the price as a share of current spot (margin signal —
            admin-only, never surfaced on client-facing pages).
          </p>
        </div>
        <div className="text-right text-xs text-ink-400">
          {spot?.asOf ? `Spot updated ${fmtTimeSince(spot.asOf)}` : '—'}
        </div>
      </div>

      <div className="mt-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by SKU, name, or metal…"
          className="input w-full md:w-96"
          autoFocus
          aria-label="Search products"
        />
        {search.trim() && (
          <span className="ml-3 text-xs text-ink-400">
            {filtered.length} match{filtered.length === 1 ? '' : 'es'}
            <button
              onClick={() => setSearch('')}
              className="ml-2 underline-offset-2 hover:underline"
            >
              clear
            </button>
          </span>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Product</th>
              {/* Column tints match the semantic side:
                  - We pay = money going out to the customer → red tint
                  - We sell = money coming in from the customer → green tint
                  Kept subtle so the numbers still lead the column. */}
              <th className="bg-red-50/70 px-4 py-3 text-right text-red-700">
                We pay
              </th>
              <th className="bg-green-50/70 px-4 py-3 text-right text-green-700">
                We sell
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-10 text-center text-sm text-ink-400"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-10 text-center text-sm text-ink-400"
                >
                  {search.trim()
                    ? `No matches for "${search}".`
                    : 'No products.'}
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <PriceRow key={p.product_id} row={p} spot={spot} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriceRow({
  row,
  spot,
}: {
  row: SheetRow;
  spot: {
    gold: string;
    silver: string;
    platinum: string;
    palladium: string;
  } | null;
}) {
  const spotForMetal = spot
    ? Number(spot[row.metal as Metal] ?? 0)
    : 0;
  // metal_content = weight × purity per unit. Multiplying by spot
  // gives the raw metal value of one unit. Dividing our quoted price
  // by that value is the "% of spot" figure — 100% means we buy/sell
  // at pure melt, 96% on a buy means we're 4pts below melt, etc.
  const weight = Number(row.weight_troy_oz) || 0;
  const purity = Number(row.purity) || 0;
  const metalContent = weight * purity;
  const meltValue = spotForMetal * metalContent;

  const buyPct =
    meltValue > 0 && row.buy_price !== null
      ? (Number(row.buy_price) / meltValue) * 100
      : null;
  const sellPct =
    meltValue > 0 && row.sell_price !== null
      ? (Number(row.sell_price) / meltValue) * 100
      : null;

  return (
    <tr className="border-t border-ink-200 hover:bg-ink-50/50">
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="font-mono text-xs text-ink-400">
          {row.sku}
          <span className="ml-2 capitalize">{row.metal}</span>
        </div>
      </td>
      <td className="bg-red-50/40 px-4 py-3 text-right">
        <div className="font-mono font-semibold text-red-700">
          {row.buy_price !== null
            ? `$${Number(row.buy_price).toFixed(2)}`
            : '—'}
        </div>
        {buyPct !== null && (
          <div className="font-mono text-[11px] text-red-500/80">
            {buyPct.toFixed(1)}% of spot
          </div>
        )}
      </td>
      <td className="bg-green-50/40 px-4 py-3 text-right">
        <div className="font-mono font-semibold text-green-700">
          {row.sell_price !== null
            ? `$${Number(row.sell_price).toFixed(2)}`
            : '—'}
        </div>
        {sellPct !== null && (
          <div className="font-mono text-[11px] text-green-600/80">
            {sellPct.toFixed(1)}% of spot
          </div>
        )}
      </td>
    </tr>
  );
}

function fmtTimeSince(iso: string): string {
  const diff = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(iso).toLocaleTimeString();
}
