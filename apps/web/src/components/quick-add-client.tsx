'use client';

/**
 * Inline "create a new client" popover used on invoice / scrap-invoice
 * creation pages. Operators previously had to navigate to
 * /admin/clients/new (losing their wizard state) to add a walk-in.
 * This component lets them spawn the client without leaving the page,
 * auto-selects the new client into the parent's combobox, and
 * invalidates the React Query cache so other pages pick it up too.
 *
 * Minimal field set on purpose — full editing happens later on the
 * client detail page. We capture only what's needed to disambiguate
 * the record + comply with the clients_has_identity DB CHECK
 * (must have first/last/company).
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './../lib/api-client';

interface CreatedClient {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  client_type: 'retail' | 'wholesaler';
}

export function QuickAddClient({
  onCreated,
  defaultType = 'retail',
}: {
  onCreated: (client: CreatedClient) => void;
  defaultType?: 'retail' | 'wholesaler';
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<'retail' | 'wholesaler'>(defaultType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFirst('');
    setLast('');
    setCompany('');
    setEmail('');
    setPhone('');
    setType(defaultType);
    setError(null);
  }

  async function submit() {
    setError(null);
    // Mirror the DB clients_has_identity CHECK constraint at the form
    // level so the error reads in plain English rather than a raw
    // Postgres message.
    if (!first.trim() && !last.trim() && !company.trim()) {
      setError('Need at least a first name, last name, or company.');
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<CreatedClient>('/admin/clients', {
        method: 'POST',
        body: JSON.stringify({
          first_name: first.trim() || undefined,
          last_name: last.trim() || undefined,
          company: company.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          client_type: type,
        }),
      });
      // Invalidate every list/picker that consumes the clients table
      // so the new row shows up in their dropdowns immediately.
      await qc.invalidateQueries({ queryKey: ['admin', 'clients'] });
      onCreated(created);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create client.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
        title="Create a new client without leaving this page"
      >
        + New client
      </button>
    );
  }

  return (
    <div className="rounded-md border border-ink-300 bg-ink-50/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-600">
          New client
        </h3>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-xs text-ink-400 hover:text-ink-700"
          disabled={busy}
        >
          Cancel
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          className="input text-sm"
          placeholder="First name"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          maxLength={80}
          disabled={busy}
        />
        <input
          className="input text-sm"
          placeholder="Last name"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          maxLength={80}
          disabled={busy}
        />
        <input
          className="input col-span-2 text-sm"
          placeholder="Company (or leave blank)"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          maxLength={200}
          disabled={busy}
        />
        <input
          className="input text-sm"
          placeholder="Email (optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={254}
          disabled={busy}
        />
        <input
          className="input text-sm"
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={40}
          disabled={busy}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-ink-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setType('retail')}
            className={
              'rounded px-2.5 py-1 text-xs font-medium transition ' +
              (type === 'retail'
                ? 'bg-ink-900 text-white'
                : 'text-ink-600 hover:text-ink-900')
            }
            disabled={busy}
          >
            Retail
          </button>
          <button
            type="button"
            onClick={() => setType('wholesaler')}
            className={
              'rounded px-2.5 py-1 text-xs font-medium transition ' +
              (type === 'wholesaler'
                ? 'bg-ink-900 text-white'
                : 'text-ink-600 hover:text-ink-900')
            }
            disabled={busy}
          >
            Wholesale
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? 'Creating…' : 'Create + select'}
        </button>
      </div>

      {error && (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
