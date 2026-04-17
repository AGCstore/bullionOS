'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface ClientRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  is_portal_enabled: boolean;
  user_id: string | null;
  invoice_count: number;
  last_invoice_at: string | null;
  score?: number;
  created_at: string;
}

export default function ClientsListPage() {
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'clients', q],
    queryFn: () =>
      apiFetch<ClientRow[]>(
        `/admin/clients${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="mt-1 text-sm text-ink-400">
            {data?.length ?? 0} client{(data?.length ?? 0) === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/admin/clients/new"
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          New client
        </Link>
      </div>

      <div className="mt-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, email, phone, city…"
          className="input md:w-96"
        />
        <p className="mt-1 text-xs text-ink-400">
          Fuzzy search — typos and partial matches work.
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email · Phone</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Portal</th>
                <th className="px-4 py-3 text-right">Invoices</th>
                <th className="px-4 py-3 text-right">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-ink-200 align-top hover:bg-ink-50/50"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/clients/${c.id}`}
                      className="font-medium hover:underline"
                    >
                      {c.last_name}, {c.first_name}
                    </Link>
                    {c.score !== undefined && (
                      <span className="ml-2 font-mono text-[10px] text-ink-400">
                        {c.score.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    <div>{c.email ?? <span className="text-ink-400">—</span>}</div>
                    <div className="text-xs text-ink-400">{c.phone ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {[c.city, c.region].filter(Boolean).join(', ') || (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.is_portal_enabled && c.user_id ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                        enabled
                      </span>
                    ) : c.user_id ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        disabled
                      </span>
                    ) : (
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-500">
                        walk-in
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{c.invoice_count}</td>
                  <td className="px-4 py-3 text-right text-ink-400">
                    {c.last_invoice_at
                      ? new Date(c.last_invoice_at).toLocaleDateString()
                      : '—'}
                  </td>
                </tr>
              ))}
              {(!data || data.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-400">
                    {q.trim() ? `No matches for "${q}".` : 'No clients yet.'}
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
