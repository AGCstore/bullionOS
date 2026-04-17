import { Injectable } from '@nestjs/common';
import type { NormalizedTrackingUpdate, ShipmentAdapter } from '../shipment-adapter';

/**
 * EasyPost — optional aggregator. Requires adding 'easypost' to the
 * integrations registry + credentials schema to activate. Left as a
 * structural stub so we can swap in aggregator-routing later without
 * touching CarrierService.
 *
 * Intentionally minimal: when wired, `track()` would hit
 *   GET https://api.easypost.com/v2/trackers?tracking_code=...
 * and map EasyPost's `tracking_details[]` to NormalizedTrackingUpdate.
 */
@Injectable()
export class EasyPostAdapter implements ShipmentAdapter {
  // EasyPost is an aggregator — the "carrier" on a shipment row is still
  // one of ups/fedex/usps/other. This adapter is selected by admin config,
  // not by the shipment's carrier column. We keep `name` pointing at 'other'
  // so the registry lookup works without schema changes.
  readonly name = 'other' as const;

  async track(_trackingNumber: string): Promise<NormalizedTrackingUpdate | null> {
    return null; // stub — not configured
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: 'EasyPost adapter not wired (needs EASYPOST_API_KEY via integrations)' };
  }
}
