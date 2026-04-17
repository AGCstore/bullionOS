'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface Product {
  id: string;
  sku: string;
  name: string;
  metal: string;
  category: string;
  weight_troy_oz: string;
  purity: string;
  metal_content_troy_oz: string;
  is_active: boolean;
  show_on_website: boolean;
}

export default function ProductsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => apiFetch<Product[]>('/admin/products'),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-sm text-ink-400">Catalog of items the shop buys and sells.</p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
        >
          New product
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Metal</th>
                <th className="px-4 py-3 text-right">Weight (oz)</th>
                <th className="px-4 py-3 text-right">Purity</th>
                <th className="px-4 py-3 text-right">Content (oz)</th>
                <th className="px-4 py-3">Flags</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((p) => (
                <tr key={p.id} className="border-t border-ink-200 hover:bg-ink-50/50">
                  <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 capitalize text-ink-600">{p.metal}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(p.weight_troy_oz).toFixed(4)}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(p.purity).toFixed(4)}</td>
                  <td className="px-4 py-3 text-right font-mono">{Number(p.metal_content_troy_oz).toFixed(4)}</td>
                  <td className="px-4 py-3">
                    {p.is_active ? (
                      <span className="mr-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                        active
                      </span>
                    ) : (
                      <span className="mr-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-400">
                        inactive
                      </span>
                    )}
                    {p.show_on_website && (
                      <span className="rounded-full bg-gold-500/10 px-2 py-0.5 text-[11px] font-medium text-gold-600">
                        web
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
