'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { PageTint } from '@/components/page-tint';
import { InlinePriceEditor, type PricingRule } from '@/components/inline-price-editor';
import { useLiveSpot } from '@/lib/use-live-spot';
import type { SheetRow } from '@/lib/sheet-types';

/**
 * "What we pay" sheet — every active product with its current buy price.
 * Mirrors /admin/in-stock-sheet but drops the availability filter so the
 * counter operator can quote on anything in the catalogue whether or not
 * we currently have it in stock. Same 60s refresh cadence; same inline
 * premium editor per row.
 */
export default function BuySheetPage() {
  const qc = useQueryClient();
  const { spot } = useLiveSpot();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', 'sheet'],
    queryFn: () => apiFetch<SheetRow[]>('/admin/products/sheet'),
    refetchInterval: 60_000,
  });

  const rows = useMemo(
    () => (data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  return (
    <PageTint side="buy">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">What we pay</h1>
            <p className="mt-1 text-sm text-ink-400">
              Every active product with the live buy price. Refreshes every minute;
              click any row to edit the premium used to compute it.
            </p>
          </div>
          <div className="text-right text-xs text-ink-400">
            {spot?.asOf ? `Spot updated ${timeSince(spot.asOf)}` : '—'}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Metal</th>
                  <th className="px-4 py-3 text-right">On hand</th>
                  <th className="px-4 py-3 text-right">We pay</th>
                  <th className="px-4 py-3 text-right">We sell</th>
                  <th className="px-4 py-3 text-right w-32">Edit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <BuyRowView
                    key={r.product_id}
                    row={r}
                    onEdited={() =>
                      qc.invalidateQueries({ queryKey: ['admin', 'products', 'sheet'] })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ink-400">
                      No active products.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PageTint>
  );
}

function BuyRowView({ row, onEdited }: { row: SheetRow; onEdited: () => void }) {
  const { data: rule } = useQuery({
    queryKey: ['admin', 'product', row.product_id, 'rule'],
    queryFn: () =>
      apiFetch<PricingRule>(`/admin/products/${row.product_id}/pricing-rule`),
  });
  return (
    <tr className="border-t border-ink-200 align-top">
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="font-mono text-xs text-ink-400">{row.sku}</div>
      </td>
      <td className="px-4 py-3 capitalize text-ink-600">{row.metal}</td>
      <td className="px-4 py-3 text-right font-mono text-ink-600">
        {row.quantity_on_hand}
      </td>
      <td className="px-4 py-3 text-right font-mono text-ink-900">
        {row.buy_price !== null ? `$${Number(row.buy_price).toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-ink-600">
        {row.sell_price !== null ? `$${Number(row.sell_price).toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-3">
        {rule ? (
          <InlinePriceEditor
            productId={row.product_id}
            rule={rule}
            onChanged={onEdited}
          />
        ) : (
          <span className="text-xs text-ink-400">…</span>
        )}
      </td>
    </tr>
  );
}

function timeSince(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(iso).toLocaleTimeString();
}
