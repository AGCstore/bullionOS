'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface SpotResponse {
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
  asOf?: string;
  as_of?: string;
  cachedAt?: number;
}

// Polls every 60s. Anywhere pricing is shown (except the invoice wizard,
// which locks prices at line-add time) refreshes on this cadence.
export function SpotTicker() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['spot'],
    queryFn: () => apiFetch<SpotResponse>('/metals/spot'),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  if (isLoading) {
    return <div className="text-xs text-ink-400">Loading spot…</div>;
  }
  if (isError || !data) {
    return <div className="text-xs text-red-600">Spot unavailable</div>;
  }

  const updated = data.asOf ?? data.as_of ?? '';
  return (
    <div className="flex items-center gap-6 text-xs">
      <TickerCell label="Gold" value={data.gold} />
      <TickerCell label="Silver" value={data.silver} />
      <TickerCell label="Platinum" value={data.platinum} />
      <TickerCell label="Palladium" value={data.palladium} />
      <span className="ml-auto text-[10px] uppercase tracking-wide text-ink-400">
        updated {formatRelative(updated)}
      </span>
    </div>
  );
}

function TickerCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{label}</span>
      <span className="font-mono text-sm font-semibold text-ink-900">
        ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
      </span>
    </div>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return d.toISOString().slice(11, 16) + ' UTC';
}
