'use client';

import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider } from '@/lib/auth-context';

/**
 * Global React Query defaults.
 *
 * staleTime (55s) — most admin pages poll every 60s, so staleTime just
 *   under the poll interval means cross-page navigation hydrates
 *   instantly from cache rather than re-fetching.
 * placeholderData: keepPreviousData — during a refetch, keep rendering
 *   the previous data instead of dropping back to undefined. Eliminates
 *   the "Loading…" flicker on every poll tick across every list page.
 *   Doesn't affect first load (no prior data) — still shows the loading
 *   state the caller expects.
 * retry: 1 — one retry on failure, same as before.
 * refetchOnWindowFocus: false — tab-switching doesn't trigger a fetch.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 55_000,
            placeholderData: keepPreviousData,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
