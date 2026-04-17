import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import type { Metal } from '../db/types';

export interface SpotPrices {
  gold: string;
  silver: string;
  platinum: string;
  palladium: string;
  /** ISO timestamp of when metals.dev last updated the prices. */
  asOf: string;
  /** Epoch ms we cached this response. */
  cachedAt: number;
}

const CACHE_KEY = 'metals:spot:v1';

@Injectable()
export class MetalsService {
  private readonly logger = new Logger(MetalsService.name);
  private readonly ttlSec: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSec = this.config.get<number>('METALS_CACHE_TTL_SEC', 30);
  }

  /**
   * Returns current spot prices per troy oz in USD.
   * Served from Redis cache when fresh; otherwise fetched from metals.dev.
   *
   * Cache strategy: SET with PX TTL. We also return from cache on upstream failure
   * as a best-effort fallback, so a metals.dev outage doesn't take down pricing.
   */
  async getSpot(): Promise<SpotPrices> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as SpotPrices;
      } catch {
        // fall through to refetch
      }
    }
    return this.refresh();
  }

  /** Force a refresh from metals.dev. */
  async refresh(): Promise<SpotPrices> {
    const url = new URL(this.config.getOrThrow<string>('METALS_API_URL'));
    url.searchParams.set('api_key', this.config.getOrThrow<string>('METALS_API_KEY'));
    url.searchParams.set('currency', 'USD');
    url.searchParams.set('unit', 'toz');

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      return this.onUpstreamFailure(err);
    }

    if (!res.ok) {
      return this.onUpstreamFailure(new Error(`metals.dev responded ${res.status}`));
    }

    const body = (await res.json()) as {
      status?: string;
      metals?: Partial<Record<Metal, number>>;
      timestamps?: { metal?: string };
    };

    if (body.status && body.status !== 'success') {
      return this.onUpstreamFailure(new Error(`metals.dev status: ${body.status}`));
    }

    const metals = body.metals ?? {};
    if (!metals.gold || !metals.silver || !metals.platinum || !metals.palladium) {
      return this.onUpstreamFailure(new Error('metals.dev returned incomplete metals map'));
    }

    const prices: SpotPrices = {
      gold: String(metals.gold),
      silver: String(metals.silver),
      platinum: String(metals.platinum),
      palladium: String(metals.palladium),
      asOf: body.timestamps?.metal ?? new Date().toISOString(),
      cachedAt: Date.now(),
    };

    await this.redis.set(CACHE_KEY, JSON.stringify(prices), 'EX', this.ttlSec);
    return prices;
  }

  /** If upstream fails but we have a stale cache entry, serve it. Otherwise throw. */
  private async onUpstreamFailure(err: unknown): Promise<SpotPrices> {
    this.logger.warn(`metals.dev fetch failed: ${(err as Error).message}`);
    const stale = await this.redis.get(CACHE_KEY);
    if (stale) {
      try {
        return JSON.parse(stale) as SpotPrices;
      } catch {
        /* fallthrough */
      }
    }
    throw new Error(`Metal prices unavailable: ${(err as Error).message}`);
  }

  /** Convenience: return the spot price for a single metal as a string. */
  async getSpotFor(metal: Metal): Promise<string> {
    const all = await this.getSpot();
    return all[metal];
  }
}
