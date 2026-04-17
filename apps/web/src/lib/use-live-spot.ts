'use client';

import { useEffect, useState } from 'react';

export interface LiveSpot {
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
  asOf: string;
  cachedAt: number;
}

/**
 * Subscribe to the SSE price stream.
 *
 * SSE is public (tokenless) so EventSource's same-origin-cookie model works
 * without custom headers. If we later move the stream behind auth, swap to
 * `@microsoft/fetch-event-source` which supports Authorization headers.
 */
export function useLiveSpot(): { spot: LiveSpot | null; error: boolean } {
  const [spot, setSpot] = useState<LiveSpot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/v1/sse/prices');
    es.addEventListener('price', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as LiveSpot;
        setSpot(data);
        setError(false);
      } catch {
        /* ignore malformed */
      }
    });
    es.onerror = () => setError(true);
    return () => es.close();
  }, []);

  return { spot, error };
}
