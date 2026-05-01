'use client';

/**
 * Client Tracking — monthly running total of NEW clients, derived
 * from calendar event titles tagged "(N)" by the operator.
 *
 * Notes on what's counted:
 *   - Only events with "(N)" in the title contribute. Returning "(R)"
 *     entries are tabulated alongside for context but the running
 *     total is new-only per Hunter's spec.
 *   - Events whose title contains "cancel" / "canceled" / "cancelled"
 *     OR have Google status === 'cancelled' are dropped server-side,
 *     so updating an existing event to mark it canceled removes it
 *     from the count automatically.
 *   - Events without "(N)" or "(R)" are ignored entirely (e.g. one-off
 *     internal blocks, vendor visits, etc.).
 */

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface TrackingBucket {
  bucket_start: string;
  bucket_label: string;
  new_count: number;
  returning_count: number;
  cumulative_new: number;
  total: number;
}

const RANGE_OPTIONS = [
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
  { value: 24, label: '24 months' },
  { value: 36, label: '36 months' },
];

export default function ClientTrackingPage() {
  const [months, setMonths] = useState<number>(12);
  const { data, isLoading, error } = useQuery<{
    months: number;
    buckets: TrackingBucket[];
  }>({
    queryKey: ['admin', 'clients', 'tracking', months],
    queryFn: () =>
      apiFetch<{ months: number; buckets: TrackingBucket[] }>(
        `/admin/clients/tracking?months=${months}`,
      ),
    staleTime: 5 * 60_000,
  });

  const buckets = data?.buckets ?? [];
  // Render most-recent first on the table — operators read top-down
  // and current-month is the first thing they want.
  const reversed = [...buckets].reverse();
  const totalNewInRange = buckets.reduce((s, b) => s + b.new_count, 0);
  const maxNew = Math.max(1, ...buckets.map((b) => b.new_count));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Client Tracking</h1>
          <p className="mt-1 text-sm text-ink-500">
            Monthly running total of new clients, sourced from calendar
            event titles tagged{' '}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">(N)</code>.
            Untagged events and events with{' '}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">cancel</code>{' '}
            in the title are skipped.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-ink-500 underline-offset-2 hover:underline"
        >
          ← dashboard
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Range
        </span>
        <div className="inline-flex rounded-md border border-ink-200 bg-white p-0.5">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setMonths(o.value)}
              className={
                'rounded px-3 py-1 text-xs font-medium transition ' +
                (months === o.value
                  ? 'bg-ink-900 text-white'
                  : 'text-ink-600 hover:text-ink-900')
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="mt-6 text-sm text-ink-400">Loading…</p>
      )}
      {error && (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Calendar integration not configured — can&apos;t pull (N) tags
          right now. Verify credentials in{' '}
          <Link
            href="/admin/integrations"
            className="underline-offset-2 hover:underline"
          >
            Integrations
          </Link>
          .
        </div>
      )}

      {!isLoading && !error && buckets.length > 0 && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
            <SummaryTile
              label={`Total new · ${months}-month range`}
              value={totalNewInRange}
            />
            <SummaryTile
              label="This month"
              value={buckets[buckets.length - 1].new_count}
            />
            <SummaryTile
              label={`Cumulative since ${buckets[0].bucket_label}`}
              value={buckets[buckets.length - 1].cumulative_new}
            />
          </div>

          {/* Inline bar chart — same scale as the dashboard sparkline,
              but spans the requested range and labels every bar. */}
          <div className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              New clients per month
            </div>
            <div className="mt-3 flex h-32 items-end gap-1">
              {buckets.map((b) => {
                const h = b.new_count > 0 ? Math.max(6, (b.new_count / maxNew) * 100) : 4;
                return (
                  <div
                    key={b.bucket_start}
                    className="flex-1"
                    title={`${b.bucket_label}: ${b.new_count} new · ${b.returning_count} returning`}
                  >
                    <div
                      className="rounded-sm bg-emerald-500"
                      style={{ height: `${h}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1 text-[9px] text-ink-400">
              {buckets.map((b) => (
                <div
                  key={b.bucket_start + '-l'}
                  className="flex-1 truncate text-center"
                >
                  {b.bucket_label.slice(0, 3)}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-ink-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Month</th>
                  <th className="px-4 py-3 text-right">New (N)</th>
                  <th className="px-4 py-3 text-right">Returning (R)</th>
                  <th className="px-4 py-3 text-right">Cumulative new</th>
                </tr>
              </thead>
              <tbody>
                {reversed.map((b, i) => (
                  <tr key={b.bucket_start} className="border-t border-ink-100">
                    <td className="px-4 py-3">
                      {b.bucket_label}
                      {i === 0 && (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                          current
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-800">
                      {b.new_count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sky-800">
                      {b.returning_count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-ink-700">
                      {b.cumulative_new}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-ink-400">
            Cumulative is the running total of new clients since the
            start of the selected range. Re-tag a Google Calendar event
            with (N), (R), or &quot;canceled&quot; and the page picks
            up the change on next refresh (5-min cache).
          </p>
        </>
      )}

      {!isLoading && !error && buckets.length > 0 && totalNewInRange === 0 && (
        <p className="mt-6 text-sm text-ink-400">
          No calendar events tagged (N) in this range. Tag bookings in
          Google Calendar with &quot;(N)&quot; in the title to start
          tracking new client volume here.
        </p>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-ink-900">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
