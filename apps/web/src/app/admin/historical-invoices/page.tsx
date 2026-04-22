'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError, getAccessToken } from '@/lib/api-client';

/**
 * Historical invoices — admin page for reconciling past-system
 * transactions into AGC Desk's KPI rollups. Day-granular, one row per
 * past invoice, totals only. Accountant can:
 *
 *   - Pick a date, quick-add rows for that day (type / amount /
 *     optional client name + reference + wholesale flag + notes).
 *   - Upload a CSV for bulk import.
 *   - See a running daily summary (count + sales/purchases/wholesale).
 *   - Edit or delete any prior row.
 *
 * Does NOT touch `invoices`, `products`, `inventory`, or any client-
 * facing surface. Flows into /admin/kpi via a UNION in the rollup SQL.
 */

type InvType = 'buy' | 'sell';

interface HistoricalInvoiceRow {
  id: string;
  date: string;
  type: InvType;
  amount: string;
  is_wholesale: boolean;
  client_id: string | null;
  client_name: string | null;
  client_display_name: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
}

interface DaySummary {
  count: number;
  sales: string;
  purchases: string;
  wholesale: string;
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function money(s: string | number): string {
  const n = Number(s);
  if (!isFinite(n)) return '$0.00';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function HistoricalInvoicesPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState<string>(todayIso());

  const { data: rows, isLoading } = useQuery({
    queryKey: ['admin', 'historical-invoices', date],
    queryFn: () =>
      apiFetch<HistoricalInvoiceRow[]>(
        `/admin/historical-invoices?from=${date}&to=${date}&limit=500`,
      ),
  });

  const { data: summary } = useQuery({
    queryKey: ['admin', 'historical-invoices', 'summary', date],
    queryFn: () =>
      apiFetch<DaySummary>(
        `/admin/historical-invoices/summary?from=${date}&to=${date}`,
      ),
  });

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'historical-invoices'] });
    qc.invalidateQueries({ queryKey: ['admin', 'kpi'] });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Historical invoices</h1>
          <p className="mt-1 text-sm text-ink-400">
            Record past-system invoices so the KPI rollup reflects prior months.
            Totals only — no line items, no inventory, no client-facing surface.
          </p>
        </div>
      </div>

      {/* Day picker + summary */}
      <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Date
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input mt-1 font-mono"
            />
          </label>
          <div className="flex-1 text-right">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              This day
            </div>
            <div className="mt-1 text-sm text-ink-700">
              <span className="font-semibold">{summary?.count ?? 0}</span> entr{summary?.count === 1 ? 'y' : 'ies'}
              {' · '}
              Sales <span className="font-mono font-semibold text-green-700">{money(summary?.sales ?? 0)}</span>
              {' · '}
              Purchases <span className="font-mono font-semibold text-red-700">{money(summary?.purchases ?? 0)}</span>
              {Number(summary?.wholesale ?? 0) > 0 && (
                <>
                  {' · '}
                  <span className="text-ink-500">of which wholesale</span>{' '}
                  <span className="font-mono font-semibold text-gold-700">{money(summary?.wholesale ?? 0)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Quick-add form */}
      <QuickAdd date={date} onAdded={refetchAll} />

      {/* CSV import */}
      <CsvImport onImported={refetchAll} />

      {/* Daily list */}
      <section className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3 text-center">Wholesale</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (rows ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-400">
                  No entries for {date}. Add one above, or upload a CSV.
                </td>
              </tr>
            )}
            {(rows ?? []).map((r) => (
              <RowEntry key={r.id} row={r} onChanged={refetchAll} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function QuickAdd({ date, onAdded }: { date: string; onAdded: () => void }) {
  const [type, setType] = useState<InvType>('sell');
  const [amount, setAmount] = useState('');
  const [clientName, setClientName] = useState('');
  const [reference, setReference] = useState('');
  const [isWholesale, setIsWholesale] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const n = Number(String(amount).replace(/[$,]/g, ''));
    if (!isFinite(n) || n < 0) {
      setError('Enter a non-negative dollar amount.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/admin/historical-invoices', {
        method: 'POST',
        body: JSON.stringify({
          date,
          type,
          amount: n,
          is_wholesale: isWholesale,
          client_name: clientName.trim() || null,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      setAmount('');
      setClientName('');
      setReference('');
      setNotes('');
      setIsWholesale(false);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        Add entry for {date}
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-6">
        <label className="block sm:col-span-1">
          <span className="text-xs font-medium text-ink-600">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InvType)}
            className="input mt-1"
          >
            <option value="sell">Sell</option>
            <option value="buy">Buy</option>
          </select>
        </label>
        <label className="block sm:col-span-1">
          <span className="text-xs font-medium text-ink-600">Amount</span>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="input mt-1 font-mono"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-600">Client (optional)</span>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Walk-in, John Smith, Acme Coins…"
            className="input mt-1"
            maxLength={200}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-ink-600">Reference (optional)</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="POS-4501, QB-2841"
            className="input mt-1 font-mono"
            maxLength={120}
          />
        </label>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={isWholesale}
            onChange={(e) => setIsWholesale(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-ink-700">Wholesale</span>
        </label>
        <label className="block sm:col-span-4">
          <span className="text-xs font-medium text-ink-600">Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input mt-1"
            maxLength={2000}
          />
        </label>
      </div>
      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          onClick={add}
          disabled={busy}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Add entry'}
        </button>
      </div>
    </section>
  );
}

function RowEntry({ row, onChanged }: { row: HistoricalInvoiceRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleWholesale() {
    setBusy(true);
    try {
      await apiFetch(`/admin/historical-invoices/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_wholesale: !row.is_wholesale }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete this ${row.type} entry of ${money(row.amount)}?`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/admin/historical-invoices/${row.id}`, { method: 'DELETE' });
      onChanged();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <tr className="border-t border-ink-200 hover:bg-ink-50/40">
      <td className="px-4 py-3">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
            row.type === 'sell'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {row.type.toUpperCase()}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono font-semibold">
        {money(row.amount)}
      </td>
      <td className="px-4 py-3 text-ink-700">
        {row.client_display_name || <span className="text-ink-400">—</span>}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-ink-500">
        {row.reference || <span className="text-ink-300">—</span>}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          onClick={toggleWholesale}
          disabled={busy}
          className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
            row.is_wholesale
              ? 'bg-gold-100 text-gold-700 hover:bg-gold-200'
              : 'bg-ink-50 text-ink-400 hover:bg-ink-100'
          }`}
        >
          {row.is_wholesale ? '✓ Wholesale' : 'Retail'}
        </button>
      </td>
      <td className="px-4 py-3 text-xs text-ink-500">
        {row.notes || <span className="text-ink-300">—</span>}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={remove}
          disabled={deleting}
          className="rounded-md border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
        >
          {deleting ? '…' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

function CsvImport({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/v1/admin/historical-invoices/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Import failed');
      setResult(json);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-ink-200 bg-ink-50/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Bulk import from CSV
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Columns (case-insensitive): <code>date</code>, <code>type</code>, <code>amount</code>,
            <code>wholesale</code>, <code>client_name</code>, <code>reference</code>, <code>notes</code>.
            The accountant can export straight from QuickBooks / the old POS and
            rename the columns to match.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id="hist-csv"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="hidden"
          />
          <label
            htmlFor="hist-csv"
            className="cursor-pointer rounded-md border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            {busy ? 'Importing…' : 'Upload CSV'}
          </label>
        </div>
      </div>

      {result && (
        <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
          Imported <strong>{result.inserted}</strong> row{result.inserted === 1 ? '' : 's'}.
          {result.errors.length > 0 && (
            <>
              {' '}
              <strong>{result.errors.length}</strong> row{result.errors.length === 1 ? '' : 's'} skipped:
              <ul className="mt-1 list-disc pl-5">
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
                {result.errors.length > 20 && <li>…{result.errors.length - 20} more.</li>}
              </ul>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
    </section>
  );
}
