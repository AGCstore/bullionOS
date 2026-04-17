'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { StatusPill } from '../page';

interface InvoiceRow {
  id: string;
  invoice_number: string;
  type: 'buy' | 'sell';
  status: string;
  subtotal: string;
  total: string;
  created_at: string;
  payment_status: string;
}

export default function InvoicesPage() {
  const { data } = useQuery({
    queryKey: ['admin', 'invoices'],
    queryFn: () => apiFetch<InvoiceRow[]>('/admin/invoices'),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Invoices</h1>
        <Link
          href="/admin/invoices/new"
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          New invoice
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((inv) => (
              <tr key={inv.id} className="border-t border-ink-200 hover:bg-ink-50/50">
                <td className="px-4 py-3 font-mono">
                  <Link href={`/admin/invoices/${inv.id}`} className="hover:underline">
                    {inv.invoice_number}
                  </Link>
                </td>
                <td className="px-4 py-3">{inv.type.toUpperCase()}</td>
                <td className="px-4 py-3">
                  <StatusPill status={inv.status} />
                </td>
                <td className="px-4 py-3 text-ink-600">{inv.payment_status}</td>
                <td className="px-4 py-3 text-right font-mono">
                  ${Number(inv.total).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-3 text-right text-ink-400">
                  {new Date(inv.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {(!data || data.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-ink-400">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
