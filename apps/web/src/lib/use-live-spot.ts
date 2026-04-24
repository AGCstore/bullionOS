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
 * Previously this subscribed to the `/api/v1/sse/prices` SSE stream, but
 * Vercel's serverless functions buffer streaming responses when Next.js
 * rewrites proxy them — the client EventSource never received a single
 * `price` event in production and spot cards stayed blank. The admin
 * SpotTicker already uses the same polling-based pattern against
 * `/metals/spot` and works fine, so aligning here drops a whole class
 * of proxy bugs.
 *
 * Cadence: 15s, matching the old SSE emit interval. The API caches
 * upstream for 30s anyway, so every other request is a cheap Redis read.
 * `refetchIntervalInBackground: true` keeps prices fresh when the tab
 * isn't focused — sales shouldn't have to click away to get a fresh
 * number.
 */
export function useLiveSpot(): { spot: LiveSpot | null; error: boolean } {
  const { data, isError } = useQuery<LiveSpot>({
    queryKey: ['live-spot'],
    queryFn: () => apiFetch<LiveSpot>('/metals/spot'),
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    // Keep the last good value on screen while a refetch is in flight
    // instead of blanking to null — avoids the "—" flash on reconnect.
    placeholderData: (prev) => prev,
  });

  return { spot: data ?? null, error: isError };
}
