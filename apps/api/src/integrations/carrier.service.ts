import { Injectable, Logger } from '@nestjs/common';
import type { ShipmentCarrier } from '../db/types';
import { UpsAdapter } from './adapters/ups.adapter';
import { FedexAdapter } from './adapters/fedex.adapter';
import { UspsAdapter } from './adapters/usps.adapter';
import { EasyPostAdapter } from './adapters/easypost.adapter';
import type { NormalizedTrackingUpdate, ShipmentAdapter } from './shipment-adapter';

/**
 * Thin dispatcher over the per-carrier adapter registry.
 *
 * History: this file previously contained UPS/FedEx/USPS HTTP calls inline.
 * It has been decomposed so each carrier is a swappable ShipmentAdapter.
 * CarrierService now only picks the right adapter from the shipment's
 * `carrier` column and delegates.
 *
 * The legacy export name `TrackingResult` is kept as an alias for
 * NormalizedTrackingUpdate so existing callers compile unchanged.
 */
export type TrackingResult = NormalizedTrackingUpdate;

@Injectable()
export class CarrierService {
  private readonly logger = new Logger(CarrierService.name);
  private readonly adapters: Map<ShipmentCarrier, ShipmentAdapter>;

  constructor(
    private readonly ups: UpsAdapter,
    private readonly fedex: FedexAdapter,
    private readonly usps: UspsAdapter,
    private readonly easypost: EasyPostAdapter,
  ) {
    this.adapters = new Map<ShipmentCarrier, ShipmentAdapter>([
      ['ups', ups],
      ['fedex', fedex],
      ['usps', usps],
      ['other', easypost],
    ]);
  }

  getAdapter(carrier: ShipmentCarrier): ShipmentAdapter | null {
    return this.adapters.get(carrier) ?? null;
  }

  /**
   * Pull latest tracking for a carrier + tracking number.
   * Returns null when:
   *  - no adapter registered for the carrier
   *  - the adapter isn't configured (no credentials stored)
   */
  async track(
    carrier: ShipmentCarrier,
    trackingNumber: string,
  ): Promise<NormalizedTrackingUpdate | null> {
    const adapter = this.getAdapter(carrier);
    if (!adapter) {
      this.logger.debug(`No adapter registered for carrier=${carrier}`);
      return null;
    }
    return adapter.track(trackingNumber);
  }

  async testConnection(
    carrier: ShipmentCarrier,
  ): Promise<{ ok: boolean; message: string }> {
    const adapter = this.getAdapter(carrier);
    if (!adapter) return { ok: false, message: `No adapter registered for ${carrier}` };
    return adapter.testConnection();
  }
}
