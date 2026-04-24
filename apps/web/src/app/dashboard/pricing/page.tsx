'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useLiveSpot, type ChangePoint } from '@/lib/use-live-spot';
import { PageTint } from '@/components/page-tint';
import { rankProducts } from '@/lib/product-search';

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

/**
 * Entry in the client's in-progress sell list. Pricing is deliberately
 * NOT captured — the list represents "I'd like to sell these; schedule
 * an appointment" rather than a priced quote. Admin sees the bulleted
 * item list on the deal request and works up a real quote after.
 */
interface SellListItem {
  product_id: string;
  name: string;
  metal: string;
  qty: number;
}

const METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;
const STORAGE_KEY = 'agc.client.sell-list.v1';

export default function ClientPricing() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['client', 'prices'],
    queryFn: () => apiFetch<PricesResponse>('/client/prices'),
    refetchInterval: 60_000,
  });
  const { spot } = useLiveSpot();

  // In-progress sell list. Persisted to sessionStorage so a page
  // refresh doesn't lose the client's work-in-progress, but clears on
  // tab close — not a long-term saved cart, just continuity across
  // accidental navigation.
  const [sellList, setSellList] = useState<SellListItem[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Rehydrate from sessionStorage on first render. Wrapped in effect
  // (not an initializer) so SSR output and the first hydrated render
  // match — otherwise React logs a hydration mismatch warning on
  // clients with a saved list.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) setSellList(JSON.parse(raw) as SellListItem[]);
    } catch {
      /* corrupt JSON — just start fresh */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sellList));
    } catch {
      /* quota exceeded / private mode — just don't persist */
    }
  }, [sellList]);

  const filteredRows = useMemo(
    () => rankProducts(data?.items ?? [], search),
    [data, search],
  );

  /** Add OR increment — merging by product_id so clicking twice
   *  bumps the quantity rather than duplicating the row. */
  function addToSellList(row: PriceRow, qty: number) {
    const addQty = Math.max(1, Math.floor(qty) || 1);
    setSellList((prev) => {
      const existing = prev.find((i) => i.product_id === row.product_id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === row.product_id
            ? { ...i, qty: i.qty + addQty }
            : i,
        );
      }
      return [
        ...prev,
        {
          product_id: row.product_id,
          name: row.name,
          metal: row.metal,
          qty: addQty,
        },
      ];
    });
  }
  function removeFromSellList(productId: string) {
    setSellList((prev) => prev.filter((i) => i.product_id !== productId));
  }
  function updateQty(productId: string, qty: number) {
    const n = Math.max(1, Math.floor(qty) || 1);
    setSellList((prev) =>
      prev.map((i) => (i.product_id === productId ? { ...i, qty: n } : i)),
    );
  }
  function clearList() {
    setSellList([]);
  }

  const totalItems = sellList.reduce((sum, i) => sum + i.qty, 0);

  return (
    <PageTint side="buy">
    <div className="mx-auto max-w-5xl">
      {/* Header: stacks on mobile so the "My quotes →" link doesn't
          crowd the title on narrow screens. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">What We Pay</h1>
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

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {METALS.map((m) => (
          <SpotCard
            key={m}
            label={m}
            price={spot?.[m]}
            change={spot?.change?.[m]}
          />
        ))}
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by SKU, name, or metal…"
          className="input w-full md:w-96"
          aria-label="Search what we pay"
        />
        {search.trim() && (
          <span className="text-xs text-ink-400">
            {filteredRows.length} match{filteredRows.length === 1 ? '' : 'es'}
            <button
              onClick={() => setSearch('')}
              className="ml-2 underline-offset-2 hover:underline"
            >
              clear
            </button>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
          Loading…
        </div>
      ) : (
        <>
          {/* Mobile: stacked cards. Padding-bottom when list has items
              so the sticky review bar doesn't obscure the last row. */}
          <section
            className={`mt-4 space-y-3 md:hidden ${
              sellList.length > 0 ? 'pb-24' : ''
            }`}
          >
            {filteredRows.map((p) => (
              <PriceRowCard
                key={p.product_id}
                row={p}
                onAdd={(qty) => addToSellList(p, qty)}
              />
            ))}
          </section>

          {/* Desktop: table stays — more density. */}
          <section className="mt-4 hidden overflow-hidden rounded-xl border border-ink-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Metal</th>
                  <th className="px-4 py-3 text-right">We pay</th>
                  <th className="px-4 py-3 text-right">Sell list</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((p) => (
                  <PriceRowView
                    key={p.product_id}
                    row={p}
                    onAdd={(qty) => addToSellList(p, qty)}
                  />
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* Sticky review bar — only when the client has items queued.
          Full-width on mobile, right-anchored pill on desktop. */}
      {sellList.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur md:inset-x-auto md:right-6 md:bottom-6 md:rounded-full md:border md:px-5 md:py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 md:max-w-none">
            <div className="text-sm">
              <span className="font-semibold text-ink-900">
                {sellList.length} item{sellList.length === 1 ? '' : 's'}
              </span>{' '}
              <span className="text-ink-500">
                ({totalItems} piece{totalItems === 1 ? '' : 's'})
              </span>
            </div>
            <button
              onClick={() => setReviewOpen(true)}
              className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
            >
              Review sell list →
            </button>
          </div>
        </div>
      )}

      {reviewOpen && (
        <SellListReview
          items={sellList}
          onClose={() => setReviewOpen(false)}
          onRemove={removeFromSellList}
          onUpdateQty={updateQty}
          onClear={() => {
            clearList();
            setReviewOpen(false);
          }}
          onSubmitted={() => {
            clearList();
            setReviewOpen(false);
          }}
        />
      )}
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
    <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm md:p-5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 md:text-xs">
        {label}
      </div>
      {/* Font scales down on mobile — a 4-digit gold price (e.g. $4,726.69)
          at text-4xl overflows a half-viewport card on a 375px phone.
          text-2xl fits; desktop keeps the larger headline. */}
      <div className="mt-1 truncate font-mono text-2xl font-semibold text-ink-900 tabular-nums md:mt-2 md:text-4xl">
        {num !== null ? (
          `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1 md:mt-2">
        {delta !== null && pct !== null ? (
          <span
            className={`font-mono text-xs font-semibold tabular-nums md:text-sm ${
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
      <div className="mt-0.5 text-[10px] text-ink-400 md:mt-1">per troy oz</div>
    </div>
  );
}

/**
 * Mobile card row. Lays out vertically so qty + Add button don't fight
 * the product name for horizontal space at narrow viewports.
 */
function PriceRowCard({
  row,
  onAdd,
}: {
  row: PriceRow;
  onAdd: (qty: number) => void;
}) {
  const [qty, setQty] = useState('1');
  const [justAdded, setJustAdded] = useState(false);

  function handleAdd() {
    const n = Math.max(1, Math.floor(Number(qty) || 0) || 1);
    onAdd(n);
    setJustAdded(true);
    // Reset the label after a short beat so a client adding multiple
    // different items sees a fresh "Add" each time rather than a
    // "Added ✓" that lingers and misleads.
    setTimeout(() => setJustAdded(false), 1200);
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink-900">{row.name}</div>
          <div className="mt-0.5 text-[11px] capitalize text-ink-400">
            {row.metal}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
            We pay
          </div>
          <div className="font-mono text-base font-semibold text-ink-900 tabular-nums">
            ${Number(row.buy_price).toFixed(2)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="input w-20 font-mono text-sm"
          aria-label="Quantity"
        />
        <button
          onClick={handleAdd}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
            justAdded
              ? 'bg-green-600 text-white'
              : 'border border-ink-200 hover:bg-ink-900 hover:text-white'
          }`}
        >
          {justAdded ? 'Added ✓' : 'Add to Sell List'}
        </button>
      </div>
    </div>
  );
}

function PriceRowView({
  row,
  onAdd,
}: {
  row: PriceRow;
  onAdd: (qty: number) => void;
}) {
  const [qty, setQty] = useState('1');
  const [justAdded, setJustAdded] = useState(false);

  function handleAdd() {
    const n = Math.max(1, Math.floor(Number(qty) || 0) || 1);
    onAdd(n);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
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
            aria-label="Quantity"
          />
          <button
            onClick={handleAdd}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              justAdded
                ? 'bg-green-600 text-white'
                : 'border border-ink-200 hover:bg-ink-900 hover:text-white'
            }`}
          >
            {justAdded ? 'Added ✓' : 'Add to Sell List'}
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Full-screen-on-mobile, centered-modal-on-desktop review of the
 * client's sell list. Edits in place (remove / update qty) and submits
 * as a single deal_request of type='sell' with a bulleted item list
 * in product_description. No pricing is sent — this is an appointment
 * request, not a quote. Admin works the real quote up after talking
 * to the client.
 */
function SellListReview({
  items,
  onClose,
  onRemove,
  onUpdateQty,
  onClear,
  onSubmitted,
}: {
  items: SellListItem[];
  onClose: () => void;
  onRemove: (productId: string) => void;
  onUpdateQty: (productId: string, qty: number) => void;
  onClear: () => void;
  onSubmitted: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (items.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const lines = items
        .map((i) => `- ${i.name} (${i.metal}) × ${i.qty}`)
        .join('\n');
      const description = `Sell list (${items.length} item${
        items.length === 1 ? '' : 's'
      }):\n${lines}`;
      const totalQty = items.reduce((s, i) => s + i.qty, 0);
      await apiFetch('/client/deal-requests', {
        method: 'POST',
        body: JSON.stringify({
          type: 'sell',
          product_description: description,
          quantity: totalQty,
          notes:
            (notes.trim() ? notes.trim() + '\n\n' : '') +
            'Client requested an appointment from the portal sell list.',
        }),
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Review sell list"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 md:items-center"
    >
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl md:rounded-2xl">
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">Your sell list</h2>
            <p className="text-xs text-ink-400">
              Request an appointment — we&rsquo;ll price these together in person.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-400">
              Your list is empty.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((i) => (
                <li
                  key={i.product_id}
                  className="flex items-center gap-3 rounded-lg border border-ink-100 bg-ink-50/40 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-900">
                      {i.name}
                    </div>
                    <div className="text-[11px] capitalize text-ink-400">
                      {i.metal}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={i.qty}
                    onChange={(e) =>
                      onUpdateQty(
                        i.product_id,
                        Math.max(1, Math.floor(Number(e.target.value) || 1)),
                      )
                    }
                    className="input w-16 font-mono text-sm"
                    aria-label={`${i.name} quantity`}
                  />
                  <button
                    onClick={() => onRemove(i.product_id)}
                    aria-label={`Remove ${i.name}`}
                    className="rounded-md border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:bg-red-50 hover:text-red-700"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-4 block">
            <span className="text-xs font-medium text-ink-500">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Anything we should know — condition, preferred appointment time, etc."
              className="input mt-1 w-full text-sm"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-ink-100 bg-white px-5 py-3">
          <button
            onClick={onClear}
            disabled={busy || items.length === 0}
            className="text-xs text-ink-500 hover:text-red-700 disabled:opacity-50"
          >
            Clear list
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-50"
            >
              Keep shopping
            </button>
            <button
              onClick={submit}
              disabled={busy || items.length === 0}
              className="rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
            >
              {busy ? 'Submitting…' : 'Request appointment'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
