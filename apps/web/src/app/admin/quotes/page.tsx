'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';

interface AdminQuoteRow {
  id: string;
  client_name: string;
  product_name: string;
  product_sku: string;
  side: 'buy' | 'sell';
  quantity: number;
  unit_price: string;
  line_total: string;
  expires_at: string;
  converted_invoice_id: string | null;
  created_at: string;
}

/**
 * NOTE: we don't have a GET /admin/quotes list endpoint (quotes are
 * client-owned). This page lets admins paste a quote id to convert it,
 * and shows recent quotes by pulling from notifications/audit. For Phase 3
 * we keep the UI simple: show an input + convert button. The client links
 * to their own quote via /dashboard/quotes.
 */
export default function AdminQuotesPage() {
  const router = useRouter();

  async function convert(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    const id = String(form.get('quote_id') || '').trim();
    if (!id) return;
    try {
      const r = await apiFetch<{ invoice_id: string; invoice_number: string }>(
        `/admin/quotes/${id}/convert`,
        { method: 'POST' },
      );
      router.push(`/admin/invoices/${r.invoice_id}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Convert failed');
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Price quotes</h1>
      <p className="mt-1 text-sm text-ink-400">
        Convert a locked client quote into a draft invoice at the captured price.
      </p>

      <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
          Convert by quote ID
        </h2>
        <form onSubmit={convert} className="mt-3 flex gap-2">
          <input
            name="quote_id"
            placeholder="Quote UUID"
            className="input flex-1 font-mono text-sm"
            required
          />
          <button
            type="submit"
            className="rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
          >
            Convert
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-400">
          Clients see their quotes at <Link href="/dashboard/quotes" className="underline">/dashboard/quotes</Link>.
          Paste a UUID above to lock the price and create a draft invoice.
        </p>
      </section>
    </div>
  );
}
