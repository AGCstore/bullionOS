'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { SheetRow } from '@/lib/sheet-types';
import { rankProducts } from '@/lib/product-search';
import { useLiveSpot } from '@/lib/use-live-spot';
import { saveOrder } from '@/lib/product-mutations';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Quick Reference Price Sheet.
 *
 * Single-surface cheat sheet for operators quoting at the counter —
 * every active product with its current buy + sell price, fuzzy
 * search at the top, and a margin signal on each side:
 *
 *   We Pay  → "X% of spot" hero   (stored rule % — stable)
 *             "$Y"          sub   (live unit price — changes with spot)
 *
 *   We Sell → "+$X over spot" hero  (stored flat rule $/oz — stable)
 *                              or  "Y% of spot" for percent-type rules
 *             "$Z"            sub  (live unit price)
 *
 * Premium displays are sourced from the RULE row (sheet payload
 * `buy_premium_*`, `sell_premium_*`) not re-derived from the rounded
 * unit price, so they don't drift as spot ticks ($200-over-spot does
 * not momentarily become $199.45).
 *
 * Ordering follows the same global sort_order every other product
 * listing honors — drag-reorder here re-ranks the catalog everywhere.
 * Disabled while a search query is active (reordering a filtered
 * subset against sparse positions would land rows in the wrong
 * places inside the full catalog — same constraint as In Stock
 * Sheet / Buy Sheet / Catalog).
 *
 * Admin-only page (admin+staff nav); margin signals never leak to
 * client-facing pricing pages.
 */

export default function PriceSheetPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const { spot } = useLiveSpot();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', 'sheet'],
    queryFn: () => apiFetch<SheetRow[]>('/admin/products/sheet'),
    refetchInterval: 60_000,
    // Keep the previous rows rendered during the 60s refetch so the
    // table doesn't flash to "Loading…" on tab re-focus or a window
    // blur/focus cycle. Without this, the poll would blank the UI
    // mid-scroll.
    placeholderData: keepPreviousData,
    // Treat data fresh for just under the poll interval so hitting
    // the page from elsewhere in the app hydrates instantly from the
    // React Query cache instead of hitting the API again.
    staleTime: 55_000,
  });

  // Empty search → rows stay in server sort_order. Active search →
  // rankProducts returns ranked hits. Reorder is disabled in that
  // mode (see below) so the ordering only matters at the display
  // layer here.
  const filtered = useMemo(
    () => rankProducts(data ?? [], search),
    [data, search],
  );

  const dragDisabled = search.trim().length > 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // bySection isn't used — price sheet is a flat list — so we work
    // off the server's full sorted catalog (data) rather than the
    // filtered view. Drag is disabled while filtered, so `data` and
    // `filtered` are identical here in practice, but using `data`
    // keeps the invariant explicit.
    const rows = data ?? [];
    const oldIdx = rows.findIndex((r) => r.product_id === active.id);
    const newIdx = rows.findIndex((r) => r.product_id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(rows, oldIdx, newIdx);
    try {
      await saveOrder(qc, reordered.map((r) => r.product_id));
    } catch (err) {
      alert((err as Error).message ?? 'Reorder failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Quick price sheet</h1>
          <p className="mt-1 text-sm text-ink-400">
            Live buy and sell prices side-by-side. Drag the handle on
            any row to reorder — the new order syncs to every other
            product-listing page.
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
            {filtered.length} match{filtered.length === 1 ? '' : 'es'} · reorder
            disabled while searching
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
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3">Product</th>
              {/* Column tints match the semantic side:
                  - We pay = money going out to the customer → red tint
                  - We sell = money coming in from the customer → green tint
                  Kept subtle so the numbers still lead the column.
                  Premium signal lives inside each price column (hero on
                  top, unit price as subtitle) — no separate bookend
                  columns anymore. */}
              <th className="bg-red-50/70 px-4 py-3 text-right text-red-700">
                We pay
              </th>
              <th className="bg-green-50/70 px-4 py-3 text-right text-green-700">
                We sell
              </th>
            </tr>
          </thead>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={filtered.map((p) => p.product_id)}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-sm text-ink-400"
                    >
                      Loading…
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-10 text-center text-sm text-ink-400"
                    >
                      {search.trim()
                        ? `No matches for "${search}".`
                        : 'No products.'}
                    </td>
                  </tr>
                )}
                {filtered.map((p) => (
                  <PriceRow
                    key={p.product_id}
                    row={p}
                    dragDisabled={dragDisabled}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
      </div>
    </div>
  );
}

function PriceRow({
  row,
  dragDisabled,
}: {
  row: SheetRow;
  dragDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.product_id, disabled: dragDisabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? '#f7f7f8' : undefined,
  };

  // Premium hero texts come from the STORED rule values, not from
  // re-deriving price/spot. That's what keeps "$200 over spot" from
  // flickering to "$199.45 over spot" as spot ticks — the rule row
  // hasn't changed, so the display shouldn't either.
  const metalContent = Number(row.metal_content_troy_oz) || 0;
  const buyHero = formatPremiumHero(
    row.buy_premium_type,
    row.buy_premium_value,
    'buy',
    metalContent,
  );
  const sellHero = formatPremiumHero(
    row.sell_premium_type,
    row.sell_premium_value,
    'sell',
    metalContent,
  );

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-t border-ink-200 hover:bg-ink-50/50"
    >
      <td className="px-2 py-3 text-center align-middle">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={dragDisabled}
          className={`px-1 ${
            dragDisabled
              ? 'cursor-not-allowed text-ink-200'
              : 'cursor-grab text-ink-400 hover:text-ink-900 active:cursor-grabbing'
          }`}
        >
          ⋮⋮
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="font-mono text-xs text-ink-400">
          {row.sku}
          <span className="ml-2 capitalize">{row.metal}</span>
        </div>
      </td>
      {/* We pay: premium (share of spot) leads, unit price subtitle.
          Premium text is rule-sourced so it doesn't drift with spot. */}
      <td className="bg-red-50/40 px-4 py-3 text-right">
        {buyHero ? (
          <>
            <div className="font-mono font-semibold text-red-700">
              {buyHero}
            </div>
            <div className="font-mono text-[11px] text-red-500/80">
              {row.buy_price !== null
                ? `$${Number(row.buy_price).toFixed(2)}`
                : '—'}
            </div>
          </>
        ) : (
          <div className="font-mono font-semibold text-red-700">
            {row.buy_price !== null
              ? `$${Number(row.buy_price).toFixed(2)}`
              : '—'}
          </div>
        )}
      </td>
      {/* We sell: premium (over spot) leads, unit price subtitle.
          Flipped from the earlier layout where $price was the hero —
          operators want the markup signal first, exact price second. */}
      <td className="bg-green-50/40 px-4 py-3 text-right">
        {sellHero ? (
          <>
            <div className="font-mono font-semibold text-green-700">
              {sellHero}
            </div>
            <div className="font-mono text-[11px] text-green-600/80">
              {row.sell_price !== null
                ? `$${Number(row.sell_price).toFixed(2)}`
                : '—'}
            </div>
          </>
        ) : (
          <div className="font-mono font-semibold text-green-700">
            {row.sell_price !== null
              ? `$${Number(row.sell_price).toFixed(2)}`
              : '—'}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Format the hero-row premium label from the stored rule.
 *
 * percent → "X% of spot"  (share-form value; 96 = 96% of melt)
 * flat    → "-$X off spot" on buy / "+$X over spot" on sell,
 *           where X = stored $/oz × metal_content_per_unit (so the
 *           figure is PER UNIT, matching the unit price below it)
 *
 * Returns null when the row has no rule attached — caller collapses
 * the two-line layout back to one line in that case.
 *
 * `dropTrailingZero` runs on the percent path: 96.30 → "96.3",
 * 96.25 → "96.25", 96.00 → "96.0" (keep at least one decimal). Per
 * operator request; the old .toFixed(2) was visually noisy for
 * round numbers.
 */
function formatPremiumHero(
  type: SheetRow['buy_premium_type'],
  value: string | null,
  side: 'buy' | 'sell',
  metalContent: number,
): string | null {
  if (!type || value === null) return null;
  const v = Number(value);
  if (!isFinite(v)) return null;
  if (type === 'percent') {
    return `${dropTrailingZero(v.toFixed(2))}% of spot`;
  }
  // flat: stored as $ per troy oz of metal content. Scale to per-unit
  // for consistency with the unit price below.
  const perUnit = v * (metalContent || 1);
  const abs = Math.abs(perUnit).toFixed(2);
  if (side === 'buy') {
    // On the buy side a positive flat value REDUCES what we pay below
    // melt, so label it as "off spot". Negative is the rare case where
    // we're paying above melt (numismatic halo, specialty coin).
    return perUnit >= 0 ? `-$${abs} off spot` : `+$${abs} over spot`;
  }
  return perUnit >= 0 ? `+$${abs} over spot` : `-$${abs} under spot`;
}

/** "96.30" → "96.3" · "96.25" → "96.25" · "96.00" → "96.0". */
function dropTrailingZero(s: string): string {
  return s.endsWith('0') && s.includes('.') && !s.endsWith('.0')
    ? s.slice(0, -1)
    : s;
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
