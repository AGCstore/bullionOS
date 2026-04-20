import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, ShipmentStatus } from '../db/types';
import { CarrierService } from './carrier.service';
import { ShipmentIngestService } from './shipment-ingest.service';

/**
 * Scheduled carrier tracking poll.
 *
 * Walks every shipment that could still move (label_created, in_transit,
 * out_for_delivery, exception) and has a non-null tracking_number, and
 * asks the carrier adapter for the latest update. Each update flows
 * through {@link ShipmentIngestService.ingest} which:
 *   - writes a shipment_tracking_events row (deduped on carrier_event_id)
 *   - advances the shipment's status if the incoming status is further
 *     along the lifecycle lattice
 *   - notifies the client on every forward status move
 *
 * Cadence: every 2 minutes, 24/7. Operator wanted near-real-time
 * visibility; carriers don't respect business hours and delivery
 * events routinely happen overnight or weekends.
 *
 * Budget check: at 2-min × 24h = 720 polls/day × N open shipments.
 * AGC's typical backlog is single-digit to low-double-digit open
 * shipments at any time, so roughly 1–10k calls/day per carrier —
 * under UPS's 10k/day free tier and well under per-minute rate caps
 * (250/min UPS). If the backlog ever scales past ~14 open at once on
 * average, revisit: either back off to 10-min OR add a
 * `last_polled_at` staleness filter so each shipment gets polled no
 * more than every 2 min regardless of cron overlap.
 *
 * Adapters return null when not configured (no DB credentials), so this
 * service gracefully no-ops for any carrier the operator hasn't wired up
 * yet. No need for feature flags or conditional scheduling.
 *
 * Terminal statuses (`delivered`, `returned`) are skipped — polling them
 * wastes quota and the event history is already complete.
 */
@Injectable()
export class ShipmentPollService {
  private readonly logger = new Logger(ShipmentPollService.name);

  // Only shipments in these statuses are worth polling. 'delivered' and
  // 'returned' are terminal — no more updates to be had.
  private static readonly OPEN_STATUSES: ShipmentStatus[] = [
    'label_created',
    'in_transit',
    'out_for_delivery',
    'exception',
  ];

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly carrier: CarrierService,
    private readonly ingest: ShipmentIngestService,
  ) {
    // Boot-time marker so Railway logs show unambiguously whether the
    // class was instantiated. If this doesn't appear, the module
    // wiring is broken; if it appears but "Scheduled poll" never
    // does, the @Cron decorator isn't wired to the scheduler.
    this.logger.log('ShipmentPollService initialized — will poll every 2 minutes');
  }

  /**
   * Fires every 2 minutes. UTC — the cron library's default TZ is
   * fine because cadence is what matters, not wall-clock alignment.
   * Carriers update their tracking feeds continuously.
   */
  // `*/2 * * * *` — every 2 minutes. @nestjs/schedule doesn't expose
  // EVERY_2_MINUTES as a named constant so we spell it out directly.
  @Cron('*/2 * * * *')
  async runScheduledPoll(): Promise<void> {
    const started = Date.now();
    const result = await this.pollOnce();
    this.logger.log(
      `Scheduled poll: scanned=${result.scanned} updated=${result.updated} failed=${result.failed} skipped=${result.skipped} in ${Date.now() - started}ms`,
    );
  }

  /**
   * Public entry point for manual invocation (admin "Refresh all" button
   * or a test run). Returns counts so the caller can display them.
   */
  async pollOnce(): Promise<{
    scanned: number;
    updated: number;
    failed: number;
    skipped: number;
  }> {
    const open = await this.db
      .selectFrom('shipments')
      .select(['id', 'carrier', 'tracking_number', 'status'])
      .where('status', 'in', ShipmentPollService.OPEN_STATUSES)
      .where('tracking_number', 'is not', null)
      .execute();

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    // Serial rather than Promise.all — carrier APIs are rate-limited and
    // we'd rather be a good citizen than bunch requests. At the volumes
    // AGC handles (single-digit-to-low-double-digit open shipments at any
    // time), the serial latency is negligible.
    for (const row of open) {
      if (!row.tracking_number) {
        skipped += 1;
        continue;
      }
      try {
        const outcome = await this.ingest.refreshShipment(
          row.id,
          (carrier, tn) => this.carrier.track(carrier, tn),
        );
        if (outcome.status === 'ok') {
          updated += 1;
        } else {
          skipped += 1;
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Poll failed for shipment=${row.id} carrier=${row.carrier}: ${(err as Error).message}`,
        );
      }
    }

    return {
      scanned: open.length,
      updated,
      failed,
      skipped,
    };
  }
}
