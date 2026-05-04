'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api-client';

export interface ChangePoint {
  baseline: string;
  delta: string;
  percent: string;
}

export interface LiveSpotChange {
  gold: ChangePoint;
  silver: ChangePoint;
  platinum: ChangePoint;
  palladium: ChangePoint;
}

export interface LiveSpot {
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
  /** Session change vs today's first-seen spot (US/Eastern). */
  change?: LiveSpotChange;
  asOf: string;
  cachedAt: number;
}

/**
 * Live spot prices with session-change deltas.
 *
 * Polls `/metals/spot` instead of subscribing to an SSE stream
 * (Vercel's serverless functions buffer streaming responses when
 * Next.js rewrites proxy them, so the client EventSource never
 * received a single `price` event in production). The polling
 * approach has no equivalent failure mode.
 *
 * Cadence: 30s while the tab is visible, paused entirely when the
 * tab is in the background. The 30s matches the BE Redis cache TTL,
 * so consecutive polls are cheap. Pausing in background trims
 * unnecessary load when an operator has multiple AGC tabs open.
 *
 * Throttling rationale: every tenant deploy hits a shared metals.dev
 * key (via the metals-proxy when configured). The 30s FE cadence +
 * 30s BE cache + 60s proxy poll layered together cap effective
 * upstream burn at 1 metals.dev call/min regardless of how many
 * tabs / operators are open.
 */
export function useLiveSpot(): { spot: LiveSpot | null; error: boolean } {
  const { data, isError } = useQuery<LiveSpot>({
    queryKey: ['live-spot'],
    queryFn: () => apiFetch<LiveSpot>('/metals/spot'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    // Keep the last good value on screen while a refetch is in flight
    // instead of blanking to null — avoids the "—" flash on reconnect.
    placeholderData: (prev) => prev,
  });

  return { spot: data ?? null, error: isError };
}
