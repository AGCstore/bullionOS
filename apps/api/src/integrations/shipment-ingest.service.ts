import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type {
  DB,
  ShipmentStatus,
  TrackingEventSource,
} from '../db/types';
import { NotificationsService } from '../notifications/notifications.service';
import type { NormalizedTrackingUpdate } from './shipment-adapter';

/**
 * Ingestion hub for normalized tracking updates.
 *
 * Entry point: {@link ingest} accepts a single NormalizedTrackingUpdate and:
 *   1. Resolves the target shipment (by carrier + tracking_number).
 *   2. Inserts a shipment_tracking_events row (idempotent on carrier_event_id).
 *   3. If the incoming status is "newer" than the shipment's current status
 *      AND different, updates the shipment and emits a notification.
 *
 * Status ordering is a fixed lattice (see {@link STATUS_ORDER}). An event
 * that moves backwards is logged but does not touch the shipment row.
 *
 * All work happens inside a single transaction so partial failures roll back.
 */

// Higher = further along the delivery lifecycle. Used to decide whether an
// incoming event should supersede the current status.
const STATUS_ORDER: Record<ShipmentStatus, number> = {
  label_created: 0,
  in_transit: 1,
  out_for_delivery: 2,
  delivered: 3,
  exception: 1, // sideways — same tier as in_transit; allow overwrite either way
  returned: 3,
};

@Injectable()
export class ShipmentIngestService {
  private readonly logger = new Logger(ShipmentIngestService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly notifications: NotificationsService,
  ) {}

  async ingest(update: NormalizedTrackingUpdate): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // Find the owning shipment. Match both carrier and tracking_number so
      // an accidental cross-carrier number collision doesn't touch the wrong row.
      const shipment = await trx
        .selectFrom('shipments')
        .select(['id', 'invoice_id', 'status', 'tracking_number'])
        .where('carrier', '=', update.carrier)
        .where('tracking_number', '=', update.tracking_number)
        .executeTakeFirst();

      if (!shipment) {
        this.logger.warn(
          `Ingest: no shipment for ${update.carrier}/${update.tracking_number}`,
        );
        return;
      }

      // Insert the event row. ON CONFLICT on (shipment_id, carrier_event_id)
      // lets webhook + poll races dedupe themselves.
      if (update.carrier_event_id) {
        await trx
          .insertInto('shipment_tracking_events')
          .values({
            shipment_id: shipment.id,
            carrier: update.carrier,
            tracking_number: update.tracking_number,
            status: update.status,
            description: update.description,
            occurred_at: update.occurred_at,
            carrier_event_id: update.carrier_event_id,
            raw_payload: sql`${JSON.stringify(update.raw_payload ?? {})}::jsonb`,
            source: update.source as TrackingEventSource,
          })
          .onConflict((oc) =>
            oc.columns(['shipment_id', 'carrier_event_id']).doNothing(),
          )
          .execute();
      } else {
        await trx
          .insertInto('shipment_tracking_events')
          .values({
            shipment_id: shipment.id,
            carrier: update.carrier,
            tracking_number: update.tracking_number,
            status: update.status,
            description: update.description,
            occurred_at: update.occurred_at,
            carrier_event_id: null,
            raw_payload: sql`${JSON.stringify(update.raw_payload ?? {})}::jsonb`,
            source: update.source as TrackingEventSource,
          })
          .execute();
      }

      // Advance the shipment row if the incoming status is a forward move.
      const currentRank = STATUS_ORDER[shipment.status];
      const newRank = STATUS_ORDER[update.status];
      if (update.status === shipment.status) return;
      if (newRank < currentRank) {
        this.logger.debug(
          `Ingest: ignoring backward move ${shipment.status}→${update.status} for shipment ${shipment.id}`,
        );
        return;
      }

      const patch: {
        status: ShipmentStatus;
        shipped_at?: Date;
        delivered_at?: Date;
      } = { status: update.status };
      if (update.status === 'in_transit') patch.shipped_at = update.occurred_at;
      if (update.status === 'delivered') patch.delivered_at = update.occurred_at;

      await trx
        .updateTable('shipments')
        .set(patch)
        .where('id', '=', shipment.id)
        .execute();

      // Notify the client on every forward move. Frequency is bounded by
      // the carrier's event cadence — usually 1–3 notifications per package.
      const invoice = await trx
        .selectFrom('invoices')
        .select(['client_id', 'invoice_number'])
        .where('id', '=', shipment.invoice_id)
        .executeTakeFirstOrThrow();
      await this.notifications.notifyClient(invoice.client_id, {
        type: 'shipment.status',
        title: `Shipment ${update.status.replace('_', ' ')}`,
        body: update.description
          ? `${invoice.invoice_number} · ${update.description}`
          : `Invoice ${invoice.invoice_number}`,
        link: `/dashboard/shipments`,
        metadata: {
          shipment_id: shipment.id,
          status: update.status,
          source: update.source,
        },
      });
    });
  }

  /** Admin-triggered refresh of one shipment from its carrier. */
  async refreshShipment(
    shipmentId: string,
    trackFn: (carrier: 'ups' | 'fedex' | 'usps' | 'other', n: string) => Promise<NormalizedTrackingUpdate | null>,
  ): Promise<{ status: 'ok' | 'skipped' | 'not_configured'; message: string }> {
    const shipment = await this.db
      .selectFrom('shipments')
      .select(['id', 'carrier', 'tracking_number'])
      .where('id', '=', shipmentId)
      .executeTakeFirst();
    if (!shipment) throw new NotFoundException('Shipment not found');
    if (!shipment.tracking_number) {
      return { status: 'skipped', message: 'No tracking number set' };
    }
    const update = await trackFn(shipment.carrier, shipment.tracking_number);
    if (!update) return { status: 'not_configured', message: `${shipment.carrier} adapter not configured` };
    await this.ingest(update);
    return { status: 'ok', message: `Ingested ${update.status}` };
  }
}
