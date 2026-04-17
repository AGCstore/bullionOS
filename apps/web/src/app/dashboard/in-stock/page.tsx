'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface InStockItem {
  product_id: string;
  sku: string;
  name: string;
  metal: string;
  category: string;
  available: number;
}

export default function ClientInStockPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['client', 'in-stock'],
    queryFn: () => apiFetch<InStockItem[]>('/client/in-stock'),
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">In stock</h1>
      <p className="mt-1 text-sm text-ink-400">
        Items currently available from AGC. Contact us to purchase.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Metal</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Available</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.product_id} className="border-t border-ink-200">
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-ink-400">{r.sku}</div>
                  </td>
                  <td className="px-4 py-3 capitalize text-ink-600">{r.metal}</td>
                  <td className="px-4 py-3 capitalize text-ink-600">{r.category}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {r.available}
                  </td>
                </tr>
              ))}
              {(!data || data.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-ink-400">
                    No items in stock right now.
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
