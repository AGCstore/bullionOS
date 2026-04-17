'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';

interface Client {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}
interface Product {
  id: string;
  sku: string;
  name: string;
  metal: string;
}
interface Quote {
  buy_unit_price: string;
  sell_unit_price: string;
  spot_per_oz: string;
}

interface DraftLine {
  product_id: string;
  quantity: number;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [clientId, setClientId] = useState<string>('');
  const [clientSearch, setClientSearch] = useState('');
  const [type, setType] = useState<'sell' | 'buy'>('sell');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: clients } = useQuery({
    queryKey: ['admin', 'clients', clientSearch],
    queryFn: () =>
      apiFetch<Client[]>(
        `/admin/clients${clientSearch ? `?q=${encodeURIComponent(clientSearch)}` : ''}`,
      ),
  });
  const { data: products } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => apiFetch<Product[]>('/admin/products'),
  });

  const selectedClient = useMemo(
    () => (clients ?? []).find((c) => c.id === clientId),
    [clients, clientId],
  );

  function addLine() {
    const first = products?.[0];
    if (!first) return;
    setLines((l) => [...l, { product_id: first.id, quantity: 1 }]);
  }
  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((l) => l.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }
  function removeLine(idx: number) {
    setLines((l) => l.filter((_, i) => i !== idx));
  }

  async function submit() {
    setError(null);
    if (!clientId) return setError('Select a client');
    if (lines.length === 0) return setError('Add at least one line item');

    setSubmitting(true);
    try {
      const created = await apiFetch<{ id: string }>('/admin/invoices', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          type,
          payment_method: paymentMethod || undefined,
          notes: notes || undefined,
          line_items: lines,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'invoices'] });
      router.push(`/admin/invoices/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">New invoice</h1>
      <p className="mt-1 text-sm text-ink-400">
        Prices computed against live spot at submission time.
      </p>

      <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
          1 · Client
        </h2>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Search name / email"
            className="input flex-1"
          />
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="input md:w-80"
          >
            <option value="">— select client —</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.last_name}, {c.first_name} {c.email ? `· ${c.email}` : ''}
              </option>
            ))}
          </select>
        </div>
        {selectedClient && (
          <p className="mt-2 text-xs text-ink-400">
            Selected: {selectedClient.first_name} {selectedClient.last_name}
          </p>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            2 · Direction
          </h2>
        </div>
        <div className="mt-3 inline-flex rounded-md border border-ink-200 bg-ink-50 p-1">
          <TypeToggle active={type === 'sell'} onClick={() => setType('sell')}>
            Sell (we sell to client)
          </TypeToggle>
          <TypeToggle active={type === 'buy'} onClick={() => setType('buy')}>
            Buy (we buy from client)
          </TypeToggle>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-ink-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            3 · Line items
          </h2>
          <button
            onClick={addLine}
            disabled={!products || products.length === 0}
            className="rounded-md border border-ink-200 px-3 py-1 text-xs hover:bg-ink-50"
          >
            + Add line
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {lines.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-400">No lines yet. Add one above.</p>
          )}
          {lines.map((line, idx) => (
            <LineRow
              key={idx}
              line={line}
              products={products ?? []}
              type={type}
              onChange={(patch) => updateLine(idx, patch)}
              onRemove={() => removeLine(idx)}
            />
          ))}
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            4 · Payment method
          </h2>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="input mt-3"
          >
            <option value="">— optional —</option>
            <option value="wire">Wire</option>
            <option value="check">Check</option>
            <option value="ach">ACH</option>
            <option value="cash">Cash</option>
            <option value="crypto">Crypto</option>
            <option value="card">Card</option>
          </select>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
            Notes
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="input mt-3"
          />
        </div>
      </section>

      {error && (
        <div role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={() => router.back()}
          className="rounded-md border border-ink-200 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create invoice'}
        </button>
      </div>
    </div>
  );
}

function TypeToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm transition ${
        active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
      }`}
    >
      {children}
    </button>
  );
}

function LineRow({
  line,
  products,
  type,
  onChange,
  onRemove,
}: {
  line: DraftLine;
  products: Product[];
  type: 'buy' | 'sell';
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const { data: quote } = useQuery({
    queryKey: ['quote', line.product_id, line.quantity],
    queryFn: () =>
      apiFetch<Quote>(`/admin/products/${line.product_id}/quote?quantity=${line.quantity}`),
    enabled: Boolean(line.product_id && line.quantity > 0),
    // Quote is already live-priced server-side; refresh as the user types.
    staleTime: 10_000,
  });

  const unit = type === 'sell' ? quote?.sell_unit_price : quote?.buy_unit_price;
  const lineTotal = unit ? Number(unit) * line.quantity : undefined;

  return (
    <div className="grid grid-cols-12 items-center gap-3">
      <select
        value={line.product_id}
        onChange={(e) => onChange({ product_id: e.target.value })}
        className="input col-span-6"
      >
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.sku} · {p.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        value={line.quantity}
        onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value)) })}
        className="input col-span-2 font-mono"
      />
      <div className="col-span-3 text-right font-mono text-sm text-ink-600">
        {lineTotal !== undefined
          ? `$${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—'}
      </div>
      <button
        onClick={onRemove}
        aria-label="Remove line"
        className="col-span-1 rounded-md border border-ink-200 px-2 py-1 text-xs hover:bg-red-50 hover:text-red-700"
      >
        ×
      </button>
    </div>
  );
}
