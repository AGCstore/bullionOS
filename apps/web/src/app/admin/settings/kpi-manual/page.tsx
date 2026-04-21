'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';

/**
 * Admin: manual KPI entries.
 *
 * Use-case: AGC had a full year of activity before this system went
 * live. Operators enter consolidated monthly totals here so the
 * dashboard 12-month chart and /admin/kpi timeline include
 * historical data alongside live invoices. Sales + Purchases are
 * single-per-month entries; Wholesale is per-wholesaler-per-month
 * (multiple rows per month possible), rolled up into one series on
 * the chart.
 *
 * Only admins can access this page (controller is @Roles('admin')).
 * Staff seats get 403 on every read, so we don't bother with a
 * client-side gate — the useQuery fails fast with a clear error if a
 * staff user wanders here.
 */

type Category = 'sales' | 'purchases' | 'wholesale';

interface ManualEntry {
  id: string;
  bucket_month: string;
  category: Category;
  client_id: string | null;
  client_name: string | null;
  amount: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  client_type: 'retail' | 'wholesaler';
}

export default function KpiManualEntriesPage() {
  const qc = useQueryClient();
  const { data: entries, isLoading } = useQuery({
    queryKey: ['admin', 'kpi-manual'],
    queryFn: () =>
      apiFetch<ManualEntry[]>('/admin/kpi/manual-entries'),
  });
  const { data: clients } = useQuery({
    queryKey: ['admin', 'clients', 'all'],
    queryFn: () => apiFetch<ClientRow[]>('/admin/clients'),
  });

  // Only wholesaler-typed clients are meaningful for wholesale entries,
  // but we show every client in the picker because historical data
  // sometimes belongs to clients who've since been reclassified.
  const wholesalers = useMemo(
    () => (clients ?? []).filter((c) => c.client_type === 'wholesaler'),
    [clients],
  );

  // Group display by month → category → entries, so the operator
  // sees a vertical spine of months with what's entered per month.
  const byMonth = useMemo(() => {
    const m = new Map<string, ManualEntry[]>();
    for (const e of entries ?? []) {
      const arr = m.get(e.bucket_month) ?? [];
      arr.push(e);
      m.set(e.bucket_month, arr);
    }
    return m;
  }, [entries]);

  const sortedMonths = Array.from(byMonth.keys()).sort().reverse();

  async function remove(id: string) {
    if (!confirm('Delete this entry?')) return;
    try {
      await apiFetch(`/admin/kpi/manual-entries/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['admin', 'kpi-manual'] });
      // Rollup cache lives under ['admin','kpi',...]; invalidate so the
      // timeline picks up the change on next focus.
      await qc.invalidateQueries({ queryKey: ['admin', 'kpi'] });
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Historical KPI entries</h1>
          <p className="mt-1 text-sm text-ink-400">
            Monthly totals from before AGC Desk went live. These appear on
            the dashboard 12-month chart and the KPI timeline for
            month/quarter/year views. Daily/weekly views stay live-only.
          </p>
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">
          Add entry
        </h2>
        <ComposeForm
          wholesalers={wholesalers}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ['admin', 'kpi-manual'] });
            await qc.invalidateQueries({ queryKey: ['admin', 'kpi'] });
          }}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">
          Existing entries
        </h2>
        {isLoading ? (
          <p className="mt-3 text-sm text-ink-400">Loading…</p>
        ) : sortedMonths.length === 0 ? (
          <p className="mt-3 text-sm text-ink-500">
            No historical entries yet. Add one above to backfill a
            month.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {sortedMonths.map((month) => (
              <MonthBlock
                key={month}
                month={month}
                entries={byMonth.get(month) ?? []}
                onDelete={remove}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MonthBlock({
  month,
  entries,
  onDelete,
}: {
  month: string;
  entries: ManualEntry[];
  onDelete: (id: string) => void;
}) {
  const totals = entries.reduce(
    (acc, e) => {
      acc[e.category] = (acc[e.category] ?? 0) + Number(e.amount);
      return acc;
    },
    { sales: 0, purchases: 0, wholesale: 0 } as Record<Category, number>,
  );
  return (
    <div className="rounded-xl border border-ink-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink-100 bg-ink-50 px-4 py-2 text-sm">
        <span className="font-semibold text-ink-900">
          {prettyMonth(month)}
        </span>
        <span className="flex flex-wrap gap-3 text-xs text-ink-500">
          <span>
            Sales <span className="font-mono text-ink-800">${totals.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
          <span>
            Purchases <span className="font-mono text-ink-800">${totals.purchases.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
          <span>
            Wholesale <span className="font-mono text-ink-800">${totals.wholesale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </span>
        </span>
      </div>
      <ul className="divide-y divide-ink-100">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                e.category === 'sales'
                  ? 'bg-sell-50 text-sell-700'
                  : e.category === 'purchases'
                    ? 'bg-buy-50 text-buy-700'
                    : 'bg-gold-500/10 text-gold-600'
              }`}
            >
              {e.category}
            </span>
            {e.category === 'wholesale' && (
              <span className="text-ink-700">
                {e.client_name ?? '(no client tag)'}
              </span>
            )}
            <span className="ml-auto font-mono text-ink-900">
              ${Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {e.notes && (
              <span className="w-full text-xs text-ink-500">{e.notes}</span>
            )}
            <button
              onClick={() => onDelete(e.id)}
              className="text-xs text-ink-400 hover:text-red-700"
              title="Delete entry"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComposeForm({
  wholesalers,
  onSaved,
}: {
  wholesalers: ClientRow[];
  onSaved: () => Promise<void> | void;
}) {
  const [bucketMonth, setBucketMonth] = useState<string>(firstOfThisMonth());
  const [category, setCategory] = useState<Category>('sales');
  const [clientId, setClientId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setFlash(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setErr('Amount must be a non-negative number');
      return;
    }
    if (category === 'wholesale' && !clientId) {
      setErr('Select a wholesaler for wholesale entries');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/admin/kpi/manual-entries', {
        method: 'POST',
        body: JSON.stringify({
          // Force-normalize to YYYY-MM-01 in case the input gave us a
          // non-first day (HTML month picker returns YYYY-MM directly,
          // but a future date-picker migration could change shapes).
          bucket_month: normalizeMonth(bucketMonth),
          category,
          client_id: category === 'wholesale' ? clientId : null,
          amount: n,
          notes: notes.trim() || undefined,
        }),
      });
      setAmount('');
      setNotes('');
      setFlash('Saved.');
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-ink-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Month
          </span>
          <input
            type="month"
            value={bucketMonth.slice(0, 7)}
            onChange={(e) => setBucketMonth(e.target.value + '-01')}
            className="input mt-1 font-mono"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Category
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            className="input mt-1"
          >
            <option value="sales">Sales</option>
            <option value="purchases">Purchases</option>
            <option value="wholesale">Wholesale</option>
          </select>
        </label>

        {category === 'wholesale' && (
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Wholesaler
            </span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="input mt-1"
            >
              <option value="">— pick a wholesaler —</option>
              {wholesalers.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayClient(c)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Amount ($)
          </span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input mt-1 font-mono"
            placeholder="0.00"
          />
        </label>

        <label className="block md:col-span-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Notes (optional)
          </span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input mt-1"
            placeholder="Source spreadsheet, QBO month, context…"
            maxLength={500}
          />
        </label>
      </div>

      {err && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {err}
        </p>
      )}
      {flash && (
        <p className="mt-2 rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-700">
          {flash}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Add entry'}
        </button>
      </div>
    </div>
  );
}

function firstOfThisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function normalizeMonth(s: string): string {
  // Accept YYYY-MM, YYYY-MM-DD, etc. → YYYY-MM-01
  const match = /^(\d{4})-(\d{2})/.exec(s);
  if (!match) return s;
  return `${match[1]}-${match[2]}-01`;
}

function prettyMonth(iso: string): string {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function displayClient(c: ClientRow): string {
  const personal = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
  if (personal) return c.company ? `${personal} · ${c.company}` : personal;
  return c.company ?? '(unnamed)';
}
