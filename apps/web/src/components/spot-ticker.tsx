'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface ChangePoint {
  baseline: string;
  delta: string;
  percent: string;
}

interface SpotResponse {
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
  /**
   * Per-metal change vs. today's session-start spot. Populated by the
   * /metals/spot endpoint when historical baseline data is available.
   * Used to render the up/down arrow + reactive color in each cell.
   */
  change?: {
    gold?: ChangePoint;
    silver?: ChangePoint;
    platinum?: ChangePoint;
    palladium?: ChangePoint;
  };
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
    return <div className="text-xs text-bos-mute">Loading spot…</div>;
  }
  if (isError || !data) {
    return <div className="text-xs text-red-400">Spot unavailable</div>;
  }

  const updated = data.asOf ?? data.as_of ?? '';
  return (
    <div className="flex items-center gap-6 text-xs">
      <TickerCell label="Gold" value={data.gold} change={data.change?.gold} />
      <TickerCell label="Silver" value={data.silver} change={data.change?.silver} />
      <TickerCell label="Platinum" value={data.platinum} change={data.change?.platinum} />
      <TickerCell label="Palladium" value={data.palladium} change={data.change?.palladium} />
      <span className="ml-auto text-[10px] uppercase tracking-wide text-bos-mute">
        updated {formatRelative(updated)}
      </span>
    </div>
  );
}

function TickerCell({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: ChangePoint;
}) {
  // Direction signal — drives the arrow glyph and the reactive color.
  // Treat near-zero deltas as flat (within 0.005% — well under any real
  // tick) so a midnight reset doesn't render a misleading arrow.
  const pct = change ? Number(change.percent) : 0;
  const direction: 'up' | 'down' | 'flat' =
    !change || !Number.isFinite(pct) || Math.abs(pct) < 0.005
      ? 'flat'
      : pct > 0
        ? 'up'
        : 'down';
  const trendColor =
    direction === 'up'
      ? 'text-emerald-400'
      : direction === 'down'
        ? 'text-red-400'
        : 'text-bos-mute';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '·';
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-bos-mute">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold text-white">
        ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
      </span>
      {change && Number.isFinite(pct) && (
        <span
          className={`font-mono text-[10px] tabular-nums ${trendColor}`}
          title={`${change.delta} since session start`}
        >
          {arrow} {Math.abs(pct).toFixed(2)}%
        </span>
      )}
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
