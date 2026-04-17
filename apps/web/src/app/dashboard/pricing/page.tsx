'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useLiveSpot, type ChangePoint } from '@/lib/use-live-spot';
import { PageTint } from '@/components/page-tint';

interface PriceRow {
  product_id: string;
  sku: string;
  name: string;
  metal: string;
  buy_price: string;
}

interface PricesResponse {
  items: PriceRow[];
  as_of: string;
}

const METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;

export default function ClientPricing() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['client', 'prices'],
    queryFn: () => apiFetch<PricesResponse>('/client/prices'),
    refetchInterval: 60_000,
  });
  const { spot } = useLiveSpot();

  return (
    <PageTint side="buy">
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">What we pay</h1>
          <p className="mt-1 text-sm text-ink-400">
            Live buy prices. Lock in a quote to hold the price for 15 minutes.
          </p>
        </div>
        <Link
          href="/dashboard/quotes"
          className="text-sm text-ink-600 underline-offset-2 hover:underline"
        >
          My quotes →
        </Link>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {METALS.map((m) => (
          <SpotCard
            key={m}
            label={m}
            price={spot?.[m]}
            change={spot?.change?.[m]}
          />
        ))}
      </section>

      <section className="mt-8 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Metal</th>
                <th className="px-4 py-3 text-right">We pay</th>
                <th className="px-4 py-3 text-right">Lock in</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((p) => (
                <PriceRowView
                  key={p.product_id}
                  row={p}
                  onQuoted={() => qc.invalidateQueries({ queryKey: ['client', 'quotes'] })}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
    </PageTint>
  );
}

function SpotCard({
  label,
  price,
  change,
}: {
  label: string;
  price: string | undefined;
  change: ChangePoint | undefined;
}) {
  const num = price ? Number(price) : null;
  const delta = change ? Number(change.delta) : null;
  const pct = change ? Number(change.percent) : null;
  const dir = delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </div>
      <div className="mt-2 font-mono text-4xl font-semibold text-ink-900 tabular-nums">
        {num !== null ? (
          `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        {delta !== null && pct !== null ? (
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${
              dir === 'up'
                ? 'text-green-700'
                : dir === 'down'
                  ? 'text-red-700'
                  : 'text-ink-400'
            }`}
          >
            {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·'}{' '}
            ${Math.abs(delta).toFixed(2)} ({pct >= 0 ? '+' : ''}
            {pct.toFixed(2)}%)
          </span>
        ) : (
          <span className="text-xs text-ink-400">session change…</span>
        )}
      </div>
      <div className="mt-1 text-[10px] text-ink-400">per troy oz</div>
    </div>
  );
}

function PriceRowView({ row, onQuoted }: { row: PriceRow; onQuoted: () => void }) {
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function lockIn() {
    setBusy(true);
    setStatus(null);
    try {
      await apiFetch('/client/quotes', {
        method: 'POST',
        body: JSON.stringify({
          product_id: row.product_id,
          side: 'sell', // client sells to us on the "what we pay" side
          quantity: Math.max(1, Number(qty) || 1),
        }),
      });
      setStatus({ kind: 'ok', msg: 'Locked · 15 min' });
      onQuoted();
    } catch (err) {
      setStatus({ kind: 'err', msg: err instanceof ApiError ? err.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-ink-200">
      <td className="px-4 py-3">
        <div className="font-medium">{row.name}</div>
        <div className="font-mono text-xs text-ink-400">{row.sku}</div>
      </td>
      <td className="px-4 py-3 capitalize text-ink-600">{row.metal}</td>
      <td className="px-4 py-3 text-right font-mono text-base font-semibold">
        ${Number(row.buy_price).toFixed(2)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input w-20 font-mono text-sm"
          />
          <button
            onClick={lockIn}
            disabled={busy}
            className="rounded-md border border-ink-200 px-3 py-1 text-xs font-medium hover:bg-ink-900 hover:text-white disabled:opacity-60"
          >
            {busy ? 'Locking…' : 'Lock in'}
          </button>
        </div>
        {status && (
          <div
            className={`mt-1 text-right text-[11px] ${
              status.kind === 'ok' ? 'text-green-700' : 'text-red-700'
            }`}
          >
            {status.msg}
          </div>
        )}
      </td>
    </tr>
  );
}
