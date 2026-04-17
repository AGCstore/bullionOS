import type { ShipmentCarrier, ShipmentStatus } from '../db/types';

/**
 * Normalized tracking update — every adapter projects the carrier's native
 * response into this shape before handing it to ShipmentsService.
 */
export interface NormalizedTrackingUpdate {
  carrier: ShipmentCarrier;
  tracking_number: string;
  status: ShipmentStatus;
  /** Carrier's latest human-readable description (verbatim). */
  description: string | null;
  /** When the event actually happened at the carrier. */
  occurred_at: Date;
  /** Carrier event id for idempotent ingestion (if the API provides one). */
  carrier_event_id: string | null;
  /** Full raw response for forensic storage. */
  raw_payload: unknown;
  /** Where this update came from. */
  source: 'webhook' | 'poll' | 'manual';
  /** Estimated delivery window end, if provided. */
  eta: Date | null;
}

export interface WebhookVerification {
  ok: boolean;
  message: string;
}

/**
 * Every carrier implementation (UPS, FedEx, USPS, EasyPost, ...) conforms
 * to this interface. CarrierService holds an adapter registry keyed by
 * provider name and never touches carrier-specific code directly.
 *
 * The `webhook` methods are optional because not every carrier has a real
 * push channel (USPS does not as of the v3 API).
 */
export interface ShipmentAdapter {
  readonly name: ShipmentCarrier;

  /** Pull the latest status for a tracking number. Null = not configured. */
  track(trackingNumber: string): Promise<NormalizedTrackingUpdate | null>;

  /**
   * Exercise the OAuth token endpoint (or equivalent) so the admin UI can
   * validate the pasted credentials without actually tracking a package.
   */
  testConnection(): Promise<{ ok: boolean; message: string }>;

  /**
   * Verify a push webhook signature. Returns ok=false if signature is invalid
   * OR if the carrier doesn't offer webhooks at all (caller should refuse the
   * request either way).
   */
  verifyWebhook?(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookVerification>;

  /** Parse an already-verified webhook body into zero or more updates. */
  parseWebhook?(rawBody: Buffer): NormalizedTrackingUpdate[];
}
