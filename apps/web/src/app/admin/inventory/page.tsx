'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { PageTint } from '@/components/page-tint';
import type { SheetRow } from '@/lib/sheet-types';

interface InventoryRow {
  product_id: string;
  sku: string;
  name: string;
  metal: string;
  category: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  available: number;
  weighted_avg_cost: string;
  last_purchase_price: string | null;
  updated_at: string;
  show_on_website: boolean;
}

export default function AdminInventoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'inventory'],
    queryFn: () => apiFetch<InventoryRow[]>('/admin/inventory'),
    refetchInterval: 60_000,
  });
  // Pull live sell prices from the sheet endpoint so the inventory table
  // can show "what we sell it for" in place of the old weighted avg cost.
  const { data: sheet } = useQuery({
    queryKey: ['admin', 'products', 'sheet'],
    queryFn: () => apiFetch<SheetRow[]>('/admin/products/sheet'),
    refetchInterval: 60_000,
  });
  const sellPriceById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const s of sheet ?? []) map.set(s.product_id, s.sell_price);
    return map;
  }, [sheet]);

  // Partition into in-stock (available > 0) and everything else so operators
  // see what they can actually sell first. Within each bucket, sort by name
  // for stable scan order.
  const { inStock, outOfStock, totalUnits } = useMemo(() => {
    const rows = data ?? [];
    const cmp = (a: InventoryRow, b: InventoryRow) => a.name.localeCompare(b.name);
    const inStock = rows.filter((r) => r.available > 0).sort(cmp);
    const outOfStock = rows.filter((r) => r.available <= 0).sort(cmp);
    const totalUnits = inStock.reduce((n, r) => n + r.available, 0);
    return { inStock, outOfStock, totalUnits };
  }, [data]);

  return (
    <PageTint side="sell">
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="mt-1 text-sm text-ink-400">
            Stock levels update automatically: buy invoices marked PAID add stock,
            sell invoices marked PAID remove stock.
          </p>
        </div>
      </div>

      {/* In-stock summary — pinned at the top per operator request so you
          see what's sellable before having to scroll past empty SKUs. */}
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="In-stock SKUs" value={String(inStock.length)} />
        <SummaryCard label="Total units available" value={String(totalUnits)} />
        <SummaryCard
          label="Out of stock"
          value={String(outOfStock.length)}
          muted
        />
        <SummaryCard
          label="Total products tracked"
          value={String((data ?? []).length)}
          muted
        />
      </section>

      <InventoryTable
        title="In stock"
        subtitle="Available to sell right now"
        rows={inStock}
        sellPriceById={sellPriceById}
        isLoading={isLoading}
        emptyText="Nothing in stock. Buy tickets marked PAID add to this list."
      />

      <InventoryTable
        title="Out of stock"
        subtitle="Tracked products with no availability"
        rows={outOfStock}
        sellPriceById={sellPriceById}
        isLoading={isLoading}
        emptyText="Everything tracked is currently in stock."
        muted
      />
    </div>
    </PageTint>
  );
}

function SummaryCard({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        muted ? 'border-ink-200 bg-white/70' : 'border-sell-200 bg-white'
      }`}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-xl font-semibold ${
          muted ? 'text-ink-600' : 'text-sell-700'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function InventoryTable({
  title,
  subtitle,
  rows,
  sellPriceById,
  isLoading,
  emptyText,
  muted,
}: {
  title: string;
  subtitle: string;
  rows: InventoryRow[];
  sellPriceById: Map<string, string | null>;
  isLoading: boolean;
  emptyText: string;
  muted?: boolean;
}) {
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className={`text-sm font-semibold ${muted ? 'text-ink-600' : 'text-sell-700'}`}>
          {title}
        </h2>
        <span className="text-xs text-ink-400">{subtitle}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Metal</th>
                <th className="px-4 py-3 text-right">On hand</th>
                <th className="px-4 py-3 text-right">Reserved</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">We sell for</th>
                <th className="px-4 py-3 text-right">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <InventoryRowView
                  key={r.product_id}
                  row={r}
                  sellPrice={sellPriceById.get(r.product_id) ?? null}
                />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                    {emptyText}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function InventoryRowView({
  row,
  sellPrice,
}: {
  row: InventoryRow;
  sellPrice: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function adjust() {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0 || !Number.isInteger(n)) {
      setError('Enter a non-zero integer');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/admin/inventory/${row.product_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ delta: n, notes: notes || undefined }),
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      setOpen(false);
      setDelta('');
      setNotes('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Adjust failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr className="border-t border-ink-200 align-top">
        <td className="px-4 py-3">
          <div className="font-medium">{row.name}</div>
          <div className="font-mono text-xs text-ink-400">{row.sku}</div>
        </td>
        <td className="px-4 py-3 capitalize text-ink-600">{row.metal}</td>
        <td className="px-4 py-3 text-right font-mono">{row.quantity_on_hand}</td>
        <td className="px-4 py-3 text-right font-mono text-ink-500">
          {row.quantity_reserved || '—'}
        </td>
        <td className="px-4 py-3 text-right font-mono font-semibold">{row.available}</td>
        <td className="px-4 py-3 text-right font-mono text-ink-900">
          {sellPrice ? `$${Number(sellPrice).toFixed(2)}` : '—'}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50"
          >
            {open ? 'Close' : 'Adjust'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-ink-100 bg-ink-50/40">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <label className="text-xs font-medium text-ink-600">
                Delta
                <input
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="+5 or -3"
                  className="input ml-2 w-24 font-mono"
                />
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason / notes"
                className="input md:w-80"
                maxLength={500}
              />
              <button
                onClick={adjust}
                disabled={busy}
                className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-60"
              >
                {busy ? 'Applying…' : 'Apply'}
              </button>
              {error && (
                <span className="text-xs text-red-700">{error}</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
