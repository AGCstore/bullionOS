'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { ShipmentStatusBadge } from '@/components/status-pill';

interface AdminShipment {
  id: string;
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  carrier: 'ups' | 'fedex' | 'usps' | 'other';
  tracking_number: string | null;
  tracking_url: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
}

const STATUS_OPTIONS = [
  { value: 'label_created', label: 'Label created' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'exception', label: 'Exception' },
  { value: 'returned', label: 'Returned' },
] as const;

export default function AdminShipmentsPage() {
  const { data } = useQuery({
    queryKey: ['admin', 'shipments'],
    queryFn: () => apiFetch<AdminShipment[]>('/admin/shipments'),
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold">Shipments</h1>
      <p className="mt-1 text-sm text-ink-400">
        Shipments are created from the invoice detail page.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Carrier</th>
              <th className="px-4 py-3">Tracking</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <ShipmentRow key={s.id} s={s} />
            ))}
            {(!data || data.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-ink-400">
                  No shipments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShipmentRow({ s }: { s: AdminShipment }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(s.tracking_number ?? '');
  const [status, setStatus] = useState(s.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/admin/shipments/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tracking_number: tracking || undefined,
          status: status !== s.status ? status : undefined,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'shipments'] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-ink-200 align-top">
      <td className="px-4 py-3 font-mono">
        <Link href={`/admin/invoices/${s.invoice_id}`} className="hover:underline">
          {s.invoice_number}
        </Link>
      </td>
      <td className="px-4 py-3">{s.client_name}</td>
      <td className="px-4 py-3 uppercase">{s.carrier}</td>
      <td className="px-4 py-3 font-mono text-xs">
        {editing ? (
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            className="input w-40 font-mono text-xs"
            placeholder="1Z..."
          />
        ) : s.tracking_url ? (
          <a
            href={s.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-900 underline-offset-2 hover:underline"
          >
            {s.tracking_number ?? '—'}
          </a>
        ) : (
          s.tracking_number ?? <span className="text-ink-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input text-xs"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <ShipmentStatusBadge status={s.status} />
        )}
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </td>
      <td className="px-4 py-3 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-ink-200 px-2 py-1 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-ink-900 px-2 py-1 text-xs text-white"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50"
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}
