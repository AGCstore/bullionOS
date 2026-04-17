'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';

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
          <p className="mt-1 text-sm text-ink-400">
            Click any row to edit pricing, weight, and catalog settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/products/import"
            className="rounded-md border border-ink-200 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50"
          >
            Import CSV
          </Link>
          <Link
            href="/admin/products/new"
            className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
          >
            New product
          </Link>
        </div>
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
                <th className="px-4 py-3 text-center">On website</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ProductRow({ product }: { product: Product }) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState(product.show_on_website);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleWebsite(next: boolean) {
    const prev = checked;
    setChecked(next); // optimistic
    setError(null);
    setBusy(true);
    try {
      await apiFetch(`/admin/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ show_on_website: next }),
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    } catch (err) {
      setChecked(prev); // rollback
      setError(err instanceof ApiError ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-ink-200 hover:bg-ink-50/50">
      <td className="px-4 py-3 font-mono text-xs">
        <Link href={`/admin/products/${product.id}`} className="hover:underline">
          {product.sku}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link href={`/admin/products/${product.id}`} className="hover:underline">
          {product.name}
        </Link>
        {!product.is_active && (
          <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-500">
            inactive
          </span>
        )}
      </td>
      <td className="px-4 py-3 capitalize text-ink-600">{product.metal}</td>
      <td className="px-4 py-3 text-right font-mono">
        {Number(product.weight_troy_oz).toFixed(4)}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        {Number(product.purity).toFixed(4)}
      </td>
      <td className="px-4 py-3 text-right font-mono">
        {Number(product.metal_content_troy_oz).toFixed(4)}
      </td>
      <td className="px-4 py-3 text-center">
        <label className="inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(e) => toggleWebsite(e.target.checked)}
            className="peer sr-only"
          />
          <div
            className={`relative h-5 w-9 rounded-full transition ${
              checked ? 'bg-green-500' : 'bg-ink-200'
            } ${busy ? 'opacity-60' : ''}`}
          >
            <div
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                checked ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </div>
        </label>
        {error && <div className="mt-1 text-[10px] text-red-700">{error}</div>}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/admin/products/${product.id}`}
          className="text-xs text-ink-600 hover:text-ink-900"
        >
          Edit →
        </Link>
      </td>
    </tr>
  );
}
