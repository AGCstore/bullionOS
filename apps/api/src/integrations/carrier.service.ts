import { Injectable, Logger } from '@nestjs/common';
import type { ShipmentCarrier, ShipmentStatus } from '../db/types';
import { IntegrationsService } from './integrations.service';

export interface TrackingResult {
  provider: ShipmentCarrier;
  tracking_number: string;
  /** Our internal status, translated from the carrier's terminology. */
  status: ShipmentStatus;
  /** Latest carrier-provided description, verbatim (e.g. "Out for delivery in ORLANDO, FL"). */
  description: string | null;
  /** Estimated or actual delivery timestamp if available. */
  eta: Date | null;
  raw: unknown;
}

/**
 * Polymorphic tracking client. Picks the right carrier implementation based
 * on the stored shipment's `carrier` field, reads credentials from the
 * IntegrationsService (admin-managed), and returns a normalized result.
 *
 * When no credentials are configured for the carrier, `track()` returns null
 * instead of throwing — the caller can fall back to "tracking unavailable"
 * without breaking the rest of the flow.
 *
 * Wire contract:
 *  - UPS   : https://onlinetools.ups.com/api/track/v1/details/:tracking
 *  - FedEx : https://apis.fedex.com/track/v1/trackingnumbers (POST)
 *  - USPS  : https://api.usps.com/tracking/v3/tracking/:tracking
 *
 * Real HTTP calls are not wired yet — the admin first configures credentials,
 * then we can flip on a "Test connection" button per carrier that exercises
 * each carrier's OAuth token endpoint. Full status polling lands once the
 * admin has successfully tested each provider.
 */
@Injectable()
export class CarrierService {
  private readonly logger = new Logger(CarrierService.name);

  constructor(private readonly integrations: IntegrationsService) {}

  async track(
    carrier: ShipmentCarrier,
    trackingNumber: string,
  ): Promise<TrackingResult | null> {
    if (carrier === 'other') return null;
    const creds = await this.integrations.getCredentials(carrier);
    if (!creds) {
      this.logger.debug(`${carrier} not configured — skipping tracking fetch`);
      return null;
    }

    // Branch per provider. Each returns a normalized TrackingResult.
    switch (carrier) {
      case 'ups':
        return this.trackUps(trackingNumber, creds as never);
      case 'fedex':
        return this.trackFedex(trackingNumber, creds as never);
      case 'usps':
        return this.trackUsps(trackingNumber, creds as never);
      default:
        return null;
    }
  }

  /**
   * Exercise the carrier's OAuth endpoint with the stored credentials. Used
   * by the admin UI's "Test connection" button to validate a freshly-entered
   * key before wiring it into the status poller.
   */
  async testConnection(carrier: ShipmentCarrier): Promise<{ ok: boolean; message: string }> {
    if (carrier === 'other') {
      return { ok: false, message: 'No endpoint for "other" carrier' };
    }
    const creds = await this.integrations.getCredentials(carrier);
    if (!creds) return { ok: false, message: 'Not configured' };

    try {
      switch (carrier) {
        case 'ups':
          await this.upsToken(creds as never);
          return { ok: true, message: 'UPS token obtained' };
        case 'fedex':
          await this.fedexToken(creds as never);
          return { ok: true, message: 'FedEx token obtained' };
        case 'usps':
          await this.uspsToken(creds as never);
          return { ok: true, message: 'USPS token obtained' };
      }
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 500) };
    }
    return { ok: false, message: 'Unknown carrier' };
  }

  // ─── UPS ─────────────────────────────────────────────────────────────

  private upsBaseUrl(env: 'cie' | 'production'): string {
    return env === 'production'
      ? 'https://onlinetools.ups.com'
      : 'https://wwwcie.ups.com';
  }

  private async upsToken(
    creds: { client_id: string; client_secret: string; environment: 'cie' | 'production' },
  ): Promise<string> {
    const auth = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
    const res = await fetch(`${this.upsBaseUrl(creds.environment)}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`UPS token ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('UPS: no access_token in response');
    return body.access_token;
  }

  private async trackUps(
    tracking: string,
    creds: { client_id: string; client_secret: string; environment: 'cie' | 'production' },
  ): Promise<TrackingResult> {
    const token = await this.upsToken(creds);
    const res = await fetch(
      `${this.upsBaseUrl(creds.environment)}/api/track/v1/details/${encodeURIComponent(tracking)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          transId: `agc-${Date.now()}`,
          transactionSrc: 'agc-crm',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`UPS track ${res.status}`);
    const body = (await res.json()) as UpsTrackResponse;
    const pkg = body.trackResponse?.shipment?.[0]?.package?.[0];
    const latest = pkg?.activity?.[0];
    const code = latest?.status?.type ?? '';
    return {
      provider: 'ups',
      tracking_number: tracking,
      status: mapUpsStatus(code),
      description: latest?.status?.description ?? null,
      eta: pkg?.deliveryDate?.[0]?.date ? parseYmd(pkg.deliveryDate[0].date) : null,
      raw: body,
    };
  }

  // ─── FedEx ───────────────────────────────────────────────────────────

  private fedexBaseUrl(env: 'sandbox' | 'production'): string {
    return env === 'production'
      ? 'https://apis.fedex.com'
      : 'https://apis-sandbox.fedex.com';
  }

  private async fedexToken(creds: {
    api_key: string;
    secret_key: string;
    environment: 'sandbox' | 'production';
  }): Promise<string> {
    const res = await fetch(`${this.fedexBaseUrl(creds.environment)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.api_key,
        client_secret: creds.secret_key,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`FedEx token ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('FedEx: no access_token in response');
    return body.access_token;
  }

  private async trackFedex(
    tracking: string,
    creds: {
      api_key: string;
      secret_key: string;
      account_number: string;
      environment: 'sandbox' | 'production';
    },
  ): Promise<TrackingResult> {
    const token = await this.fedexToken(creds);
    const res = await fetch(`${this.fedexBaseUrl(creds.environment)}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
      body: JSON.stringify({
        includeDetailedScans: true,
        trackingInfo: [{ trackingNumberInfo: { trackingNumber: tracking } }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`FedEx track ${res.status}`);
    const body = (await res.json()) as FedexTrackResponse;
    const info = body.output?.completeTrackResults?.[0]?.trackResults?.[0];
    const latest = info?.latestStatusDetail;
    return {
      provider: 'fedex',
      tracking_number: tracking,
      status: mapFedexStatus(latest?.code ?? ''),
      description: latest?.description ?? null,
      eta: info?.estimatedDeliveryTimeWindow?.window?.ends
        ? new Date(info.estimatedDeliveryTimeWindow.window.ends)
        : null,
      raw: body,
    };
  }

  // ─── USPS ────────────────────────────────────────────────────────────

  private uspsBaseUrl(env: 'test' | 'production'): string {
    // USPS uses the same host; environment is controlled by the token scope.
    return env === 'production' ? 'https://api.usps.com' : 'https://apis-tem.usps.com';
  }

  private async uspsToken(creds: {
    consumer_key: string;
    consumer_secret: string;
    environment: 'test' | 'production';
  }): Promise<string> {
    const res = await fetch(`${this.uspsBaseUrl(creds.environment)}/oauth2/v3/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.consumer_key,
        client_secret: creds.consumer_secret,
        scope: 'tracking',
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      throw new Error(`USPS token ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('USPS: no access_token in response');
    return body.access_token;
  }

  private async trackUsps(
    tracking: string,
    creds: {
      consumer_key: string;
      consumer_secret: string;
      environment: 'test' | 'production';
    },
  ): Promise<TrackingResult> {
    const token = await this.uspsToken(creds);
    const res = await fetch(
      `${this.uspsBaseUrl(creds.environment)}/tracking/v3/tracking/${encodeURIComponent(tracking)}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`USPS track ${res.status}`);
    const body = (await res.json()) as UspsTrackResponse;
    const stage = body?.trackingEvents?.[0];
    return {
      provider: 'usps',
      tracking_number: tracking,
      status: mapUspsStatus(body?.statusCategory ?? ''),
      description: stage?.eventType ?? body?.statusSummary ?? null,
      eta: body?.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : null,
      raw: body,
    };
  }
}

// ─── Status mapping ────────────────────────────────────────────────────
// Each carrier has its own vocabulary; we collapse to our ShipmentStatus enum.

function mapUpsStatus(code: string): ShipmentStatus {
  // UPS type codes: M=Manifested, I=In Transit, O=Out for delivery, D=Delivered, X=Exception.
  switch (code.toUpperCase()) {
    case 'D':
      return 'delivered';
    case 'O':
      return 'out_for_delivery';
    case 'I':
    case 'P':
      return 'in_transit';
    case 'X':
      return 'exception';
    case 'RS':
      return 'returned';
    default:
      return 'label_created';
  }
}

function mapFedexStatus(code: string): ShipmentStatus {
  switch (code.toUpperCase()) {
    case 'DL':
      return 'delivered';
    case 'OD':
      return 'out_for_delivery';
    case 'IT':
    case 'AR':
    case 'DP':
      return 'in_transit';
    case 'DE':
    case 'CA':
      return 'exception';
    case 'RS':
      return 'returned';
    default:
      return 'label_created';
  }
}

function mapUspsStatus(cat: string): ShipmentStatus {
  switch (cat.toUpperCase()) {
    case 'DELIVERED':
      return 'delivered';
    case 'OUT_FOR_DELIVERY':
      return 'out_for_delivery';
    case 'IN_TRANSIT':
    case 'ACCEPTED':
      return 'in_transit';
    case 'ALERT':
    case 'FAILURE':
      return 'exception';
    case 'RETURNED':
      return 'returned';
    default:
      return 'label_created';
  }
}

function parseYmd(s: string): Date | null {
  // UPS returns YYYYMMDD with no separator.
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
}

// ─── Carrier response shapes (only the fields we actually read) ────────

interface UpsTrackResponse {
  trackResponse?: {
    shipment?: Array<{
      package?: Array<{
        activity?: Array<{
          status?: { type?: string; description?: string };
        }>;
        deliveryDate?: Array<{ date?: string }>;
      }>;
    }>;
  };
}

interface FedexTrackResponse {
  output?: {
    completeTrackResults?: Array<{
      trackResults?: Array<{
        latestStatusDetail?: { code?: string; description?: string };
        estimatedDeliveryTimeWindow?: { window?: { ends?: string } };
      }>;
    }>;
  };
}

interface UspsTrackResponse {
  statusCategory?: string;
  statusSummary?: string;
  expectedDeliveryDate?: string;
  trackingEvents?: Array<{ eventType?: string }>;
}
