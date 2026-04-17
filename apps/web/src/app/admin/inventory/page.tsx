'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';

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
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="mt-1 text-sm text-ink-400">
            Stock levels update automatically: buy invoices marked PAID add stock,
            sell invoices marked SHIPPED remove stock.
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
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
                <th className="px-4 py-3 text-right">Avg cost</th>
                <th className="px-4 py-3 text-right">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <InventoryRowView key={r.product_id} row={r} />
              ))}
              {(!data || data.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                    No inventory records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function InventoryRowView({ row }: { row: InventoryRow }) {
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
        <td className="px-4 py-3 text-right font-mono text-ink-600">
          ${Number(row.weighted_avg_cost).toFixed(2)}
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
