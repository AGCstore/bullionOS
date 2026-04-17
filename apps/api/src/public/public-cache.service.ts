import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

/**
 * Tiny cache layer for public endpoints.
 *
 * Design
 * ------
 *   - Single namespace prefix `public:` so we can wipe all public cache with
 *     one pattern delete in emergencies.
 *   - Each cache entry is keyed by a short name and carries a TTL.
 *   - Invalidation is coarse: when a product or pricing-rule changes, blow
 *     away the full public feed cache. We never see enough traffic on public
 *     admin mutations to justify finer-grained tagging.
 *   - Cache failures are non-fatal. If Redis is down we bypass cache and
 *     the endpoint falls back to a fresh compute.
 */
@Injectable()
export class PublicCacheService {
  private readonly log = new Logger(PublicCacheService.name);
  static readonly PREFIX = 'public:';
  static readonly KEY_WHAT_WE_PAY = 'public:what-we-pay:v1';
  static readonly KEY_IN_STOCK = 'public:in-stock:v1';

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.warn(`cache get failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (err) {
      this.log.warn(`cache set failed for ${key}: ${(err as Error).message}`);
    }
  }

  /** Called by ProductsService and PricingRulesService on any mutation. */
  async invalidatePricingDependent(): Promise<void> {
    try {
      await this.redis.del(PublicCacheService.KEY_WHAT_WE_PAY);
      await this.redis.del(PublicCacheService.KEY_IN_STOCK);
    } catch (err) {
      this.log.warn(`cache invalidate failed: ${(err as Error).message}`);
    }
  }

  /** Called when an inventory movement lands (affects in-stock). */
  async invalidateInventory(): Promise<void> {
    try {
      await this.redis.del(PublicCacheService.KEY_IN_STOCK);
    } catch (err) {
      this.log.warn(`cache invalidate failed: ${(err as Error).message}`);
    }
  }
}
