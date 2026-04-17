'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface Shipment {
  id: string;
  invoice_id: string;
  invoice_number: string;
  carrier: 'ups' | 'fedex' | 'usps' | 'other';
  tracking_number: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
  tracking_url: string | null;
}

export default function ClientShipments() {
  const { data, isLoading } = useQuery({
    queryKey: ['client', 'shipments'],
    queryFn: () => apiFetch<Shipment[]>('/client/shipments'),
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">Shipments</h1>
      <p className="mt-1 text-sm text-ink-400">Track your orders.</p>

      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Carrier</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Shipped</th>
                <th className="px-4 py-3 text-right">Delivered</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((s) => (
                <tr key={s.id} className="border-t border-ink-200">
                  <td className="px-4 py-3 font-mono">
                    <Link
                      href={`/dashboard/transactions/${s.invoice_id}`}
                      className="hover:underline"
                    >
                      {s.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 uppercase">{s.carrier}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {s.tracking_number ? (
                      s.tracking_url ? (
                        <a
                          href={s.tracking_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-900 underline-offset-2 hover:underline"
                        >
                          {s.tracking_number}
                        </a>
                      ) : (
                        s.tracking_number
                      )
                    ) : (
                      <span className="text-ink-400">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ShipmentStatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-right text-ink-400">
                    {s.shipped_at ? new Date(s.shipped_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-400">
                    {s.delivered_at ? new Date(s.delivered_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
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
        )}
      </div>
    </div>
  );
}

export function ShipmentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    label_created: 'bg-ink-100 text-ink-600',
    in_transit: 'bg-blue-100 text-blue-700',
    out_for_delivery: 'bg-violet-100 text-violet-700',
    delivered: 'bg-green-100 text-green-700',
    exception: 'bg-amber-100 text-amber-700',
    returned: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        styles[status] ?? 'bg-ink-100 text-ink-600'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
