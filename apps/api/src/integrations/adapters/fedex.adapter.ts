import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations.service';
import type { CredentialsFor } from '../integrations.registry';
import type { NormalizedTrackingUpdate, ShipmentAdapter } from '../shipment-adapter';
import type { ShipmentStatus } from '../../db/types';

type FedexCreds = CredentialsFor<'fedex'>;

interface FedexTrackResponse {
  output?: {
    completeTrackResults?: Array<{
      trackResults?: Array<{
        latestStatusDetail?: { code?: string; description?: string };
        estimatedDeliveryTimeWindow?: { window?: { ends?: string } };
        dateAndTimes?: Array<{ type?: string; dateTime?: string }>;
      }>;
    }>;
  };
}

@Injectable()
export class FedexAdapter implements ShipmentAdapter {
  readonly name = 'fedex' as const;

  constructor(private readonly integrations: IntegrationsService) {}

  async track(trackingNumber: string): Promise<NormalizedTrackingUpdate | null> {
    const creds = await this.integrations.getCredentials('fedex');
    if (!creds) return null;
    const token = await this.getToken(creds);
    const res = await fetch(`${this.baseUrl(creds.environment)}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
      body: JSON.stringify({
        includeDetailedScans: true,
        trackingInfo: [{ trackingNumberInfo: { trackingNumber } }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`FedEx track ${res.status}`);
    const body = (await res.json()) as FedexTrackResponse;
    const info = body.output?.completeTrackResults?.[0]?.trackResults?.[0];
    const latest = info?.latestStatusDetail;

    // Prefer ACTUAL_DELIVERY / SHIP timestamps when present.
    const ts = info?.dateAndTimes?.find((d) => d.type === 'ACTUAL_DELIVERY')?.dateTime
            ?? info?.dateAndTimes?.find((d) => d.type === 'ACTUAL_PICKUP')?.dateTime
            ?? info?.dateAndTimes?.[0]?.dateTime;

    return {
      carrier: 'fedex',
      tracking_number: trackingNumber,
      status: mapFedexStatus(latest?.code ?? ''),
      description: latest?.description ?? null,
      occurred_at: ts ? new Date(ts) : new Date(),
      carrier_event_id: latest?.code ? `${ts ?? ''}:${latest.code}` : null,
      raw_payload: body,
      source: 'poll',
      eta: info?.estimatedDeliveryTimeWindow?.window?.ends
        ? new Date(info.estimatedDeliveryTimeWindow.window.ends)
        : null,
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const creds = await this.integrations.getCredentials('fedex');
    if (!creds) return { ok: false, message: 'Not configured' };
    try {
      await this.getToken(creds);
      return { ok: true, message: 'FedEx token obtained' };
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 500) };
    }
  }

  // ─── private ───────────────────────────────────────────────────────

  private baseUrl(env: 'sandbox' | 'production'): string {
    return env === 'production' ? 'https://apis.fedex.com' : 'https://apis-sandbox.fedex.com';
  }

  private async getToken(creds: FedexCreds): Promise<string> {
    const res = await fetch(`${this.baseUrl(creds.environment)}/oauth/token`, {
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

export const _fedex = { mapFedexStatus };
