'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken } from '@/lib/api-client';

interface PreviewRow {
  row_number: number;
  sku: string;
  name: string;
  metal: string;
  category: string;
  weight_troy_oz: string;
  purity: string;
  show_on_website: boolean;
  description: string | null;
  action: 'create' | 'update' | 'error';
  error: string | null;
}

interface PreviewResult {
  total: number;
  to_create: number;
  to_update: number;
  errors: number;
  rows: PreviewRow[];
}

/** Sample CSV template users can download to see the expected shape. */
const TEMPLATE = `sku,name,metal,category,weight_troy_oz,purity,show_on_website,description
AU-EAGLE-1OZ,1 oz American Gold Eagle,gold,coin,1.0909,0.9167,true,
AG-EAGLE-1OZ,1 oz American Silver Eagle,silver,coin,1.0,0.999,true,
AU-BAR-10OZ,10 oz Gold Bar (.9999),gold,bar,10,0.9999,false,
`;

export default function ImportProductsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'commit'>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  async function runPreview() {
    if (!file) return;
    setBusy('preview');
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/v1/admin/products/import/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? `Preview failed (${res.status})`);
      setPreview(body as PreviewResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runCommit() {
    if (!file) return;
    if (!preview || preview.to_create + preview.to_update === 0) {
      setError('Nothing to commit');
      return;
    }
    if (!confirm(
      `Commit ${preview.to_create} new and ${preview.to_update} updated rows? ` +
      (preview.errors > 0 ? `${preview.errors} error rows will be skipped.` : '')
    )) return;
    setBusy('commit');
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/v1/admin/products/import/commit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? `Commit failed (${res.status})`);
      setResult(body as { created: number; updated: number; skipped: number });
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'products-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4">
        <Link href="/admin/products" className="text-sm text-ink-600 hover:text-ink-900">
          ← All products
        </Link>
      </div>

      <h1 className="text-2xl font-semibold">Import products</h1>
      <p className="mt-1 text-sm text-ink-400">
        Upload a CSV, preview the changes, then commit. New SKUs are created;
        existing SKUs are updated (except <code>is_active</code>, which is
        preserved). Invalid rows are skipped, never halt the whole import.
      </p>

      <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
          1 · Choose file
        </h2>
        <p className="mt-1 text-xs text-ink-400">
          Required columns: <code>sku, name, metal, category, weight_troy_oz, purity</code>.
          Optional: <code>show_on_website, description</code>.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setError(null);
            }}
            className="text-sm"
          />
          <button
            onClick={downloadTemplate}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50"
          >
            Download template
          </button>
          <button
            onClick={runPreview}
            disabled={!file || busy !== null}
            className="ml-auto rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
          >
            {busy === 'preview' ? 'Previewing…' : 'Preview'}
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {preview && (
        <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                2 · Review preview
              </h2>
              <p className="mt-1 text-sm text-ink-800">
                <strong>{preview.total}</strong> row{preview.total === 1 ? '' : 's'}:{' '}
                <span className="text-green-700">{preview.to_create} new</span>,{' '}
                <span className="text-blue-700">{preview.to_update} updated</span>,{' '}
                <span className={preview.errors > 0 ? 'text-red-700' : 'text-ink-400'}>
                  {preview.errors} error{preview.errors === 1 ? '' : 's'}
                </span>
              </p>
            </div>
            <button
              onClick={runCommit}
              disabled={busy !== null || preview.to_create + preview.to_update === 0}
              className="rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
            >
              {busy === 'commit' ? 'Committing…' : 'Commit import'}
            </button>
          </div>

          <div className="mt-4 max-h-[32rem] overflow-y-auto rounded-md border border-ink-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-ink-50 text-left uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Action</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Metal</th>
                  <th className="px-2 py-2">Wt × Purity</th>
                  <th className="px-2 py-2">Web</th>
                  <th className="px-2 py-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row_number} className="border-t border-ink-100">
                    <td className="px-2 py-1.5 font-mono text-ink-400">{r.row_number}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          r.action === 'create'
                            ? 'bg-green-100 text-green-700'
                            : r.action === 'update'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono">{r.sku || '—'}</td>
                    <td className="px-2 py-1.5">{r.name || '—'}</td>
                    <td className="px-2 py-1.5 capitalize">{r.metal || '—'}</td>
                    <td className="px-2 py-1.5 font-mono">
                      {r.weight_troy_oz}×{r.purity}
                    </td>
                    <td className="px-2 py-1.5">{r.show_on_website ? '✓' : ''}</td>
                    <td className="px-2 py-1.5 text-red-700">{r.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result && (
        <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
          <h2 className="text-sm font-semibold text-green-900">Import complete</h2>
          <p className="mt-1 text-sm text-green-800">
            {result.created} created · {result.updated} updated · {result.skipped} skipped
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => router.push('/admin/products')}
              className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800"
            >
              Back to products
            </button>
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
                setResult(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-xs"
            >
              Import another
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
