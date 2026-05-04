/**
 * BullionOS Metals Proxy
 *
 * A small Express service that fronts metals.dev with one shared API
 * key, caches the snapshot in-memory, and serves it to N tenant API
 * deploys via per-tenant Bearer keys.
 *
 *   metals.dev  <----  this proxy  <----  tenant1 API
 *                              ^---------- tenant2 API
 *                              ^---------- ... etc
 *
 * Why a proxy:
 *   - One metals.dev call per minute regardless of tenant count.
 *   - Per-tenant keys can be rotated/revoked without redeploying
 *     each tenant's stack.
 *   - Tenant deploys never see the master metals.dev key.
 *
 * Configuration (env):
 *   METALS_API_KEY        master metals.dev API key (required)
 *   METALS_API_URL        default https://api.metals.dev/v1/latest
 *   POLL_INTERVAL_MS      default 60000 (60s)
 *   TENANT_KEYS           comma-separated tenant Bearer keys
 *                         (each token is checked in constant time)
 *   PORT                  default 4001
 *
 * Endpoints:
 *   GET /health           liveness, no auth
 *   GET /spot             cached metals.dev snapshot, requires
 *                         Bearer auth
 *
 * Errors:
 *   401 missing/bad bearer
 *   503 cache empty (proxy still starting up or metals.dev down)
 */

import express, { type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';

interface MetalsSnapshot {
  status: 'success';
  metals: {
    gold: number;
    silver: number;
    platinum: number;
    palladium: number;
  };
  timestamps: { metal: string };
  /** When this proxy fetched the snapshot. */
  cachedAt: string;
}

const METALS_API_KEY = process.env.METALS_API_KEY;
const METALS_API_URL =
  process.env.METALS_API_URL ?? 'https://api.metals.dev/v1/latest';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);
const PORT = Number(process.env.PORT ?? 4001);
const TENANT_KEYS = (process.env.TENANT_KEYS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter((k) => k.length >= 16);

if (!METALS_API_KEY) {
  console.error('FATAL: METALS_API_KEY is required');
  process.exit(1);
}
if (TENANT_KEYS.length === 0) {
  console.error(
    'FATAL: TENANT_KEYS is empty — supply at least one Bearer token (>= 16 chars) so tenant deploys can authenticate',
  );
  process.exit(1);
}

let cache: MetalsSnapshot | null = null;
let consecutiveFailures = 0;

async function fetchOnce(): Promise<void> {
  const url = new URL(METALS_API_URL);
  url.searchParams.set('api_key', METALS_API_KEY!);
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('unit', 'toz');
  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      consecutiveFailures++;
      console.warn(
        `[metals-proxy] upstream ${res.status} (failures=${consecutiveFailures})`,
      );
      return;
    }
    const body = (await res.json()) as {
      status?: string;
      metals?: Partial<Record<'gold' | 'silver' | 'platinum' | 'palladium', number>>;
      timestamps?: { metal?: string };
    };
    if (body.status && body.status !== 'success') {
      consecutiveFailures++;
      console.warn(`[metals-proxy] upstream status=${body.status}`);
      return;
    }
    const m = body.metals ?? {};
    if (
      typeof m.gold !== 'number' ||
      typeof m.silver !== 'number' ||
      typeof m.platinum !== 'number' ||
      typeof m.palladium !== 'number'
    ) {
      consecutiveFailures++;
      console.warn('[metals-proxy] upstream returned incomplete metals map');
      return;
    }
    cache = {
      status: 'success',
      metals: {
        gold: m.gold,
        silver: m.silver,
        platinum: m.platinum,
        palladium: m.palladium,
      },
      timestamps: { metal: body.timestamps?.metal ?? new Date().toISOString() },
      cachedAt: new Date().toISOString(),
    };
    if (consecutiveFailures > 0) {
      console.log(
        `[metals-proxy] recovered after ${consecutiveFailures} failure(s)`,
      );
    }
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures++;
    console.warn(
      `[metals-proxy] fetch failed (failures=${consecutiveFailures}): ${(err as Error).message}`,
    );
  }
}

/**
 * Constant-time match of the inbound Bearer token against the allowed
 * tenant keys. Avoids leaking which keys are valid via timing.
 */
function isAllowedKey(provided: string): boolean {
  const buf = Buffer.from(provided);
  for (const k of TENANT_KEYS) {
    const kb = Buffer.from(k);
    if (kb.length !== buf.length) continue;
    if (timingSafeEqual(kb, buf)) return true;
  }
  return false;
}

function authMiddleware(
  req: Request,
  res: Response,
  next: () => void,
): void {
  const auth = req.header('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing Bearer token' });
    return;
  }
  const token = auth.slice('Bearer '.length).trim();
  if (!isAllowedKey(token)) {
    res.status(401).json({ error: 'invalid Bearer token' });
    return;
  }
  next();
}

const app = express();

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    cached: cache !== null,
    cachedAt: cache?.cachedAt ?? null,
    consecutiveFailures,
    tenantKeys: TENANT_KEYS.length,
  });
});

app.get('/spot', authMiddleware, (_req: Request, res: Response) => {
  if (!cache) {
    res.status(503).json({ error: 'cache empty — proxy starting up' });
    return;
  }
  // 30s browser/CDN cache on top of the in-memory snapshot. Tenant API
  // is the only consumer (server-to-server), so this is mostly an
  // additional safety belt.
  res.set('Cache-Control', 'public, max-age=30');
  res.json(cache);
});

app.use((_req: Request, res: ServerResponse) => {
  res.statusCode = 404;
  res.end();
});

// Kick off the polling loop. First fetch happens immediately so a
// fresh deploy can serve /spot within seconds; subsequent fetches
// are paced by POLL_INTERVAL_MS.
void fetchOnce();
setInterval(() => {
  void fetchOnce();
}, POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(
    `[metals-proxy] listening on :${PORT} (polling every ${POLL_INTERVAL_MS}ms, ${TENANT_KEYS.length} tenant keys)`,
  );
});
