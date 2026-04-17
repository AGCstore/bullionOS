import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations.service';
import type { CredentialsFor } from '../integrations.registry';
import type { NormalizedTrackingUpdate, ShipmentAdapter } from '../shipment-adapter';
import type { ShipmentStatus } from '../../db/types';

type UspsCreds = CredentialsFor<'usps'>;

interface UspsTrackResponse {
  statusCategory?: string;
  statusSummary?: string;
  expectedDeliveryDate?: string;
  trackingEvents?: Array<{
    eventType?: string;
    eventTimestamp?: string;
    eventCity?: string;
    eventState?: string;
  }>;
}

@Injectable()
export class UspsAdapter implements ShipmentAdapter {
  readonly name = 'usps' as const;

  constructor(private readonly integrations: IntegrationsService) {}

  async track(trackingNumber: string): Promise<NormalizedTrackingUpdate | null> {
    const creds = await this.integrations.getCredentials('usps');
    if (!creds) return null;
    const token = await this.getToken(creds);
    const res = await fetch(
      `${this.baseUrl(creds.environment)}/tracking/v3/tracking/${encodeURIComponent(trackingNumber)}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) throw new Error(`USPS track ${res.status}`);
    const body = (await res.json()) as UspsTrackResponse;
    const stage = body?.trackingEvents?.[0];
    const occurred = stage?.eventTimestamp ? new Date(stage.eventTimestamp) : new Date();

    return {
      carrier: 'usps',
      tracking_number: trackingNumber,
      status: mapUspsStatus(body?.statusCategory ?? ''),
      description: stage?.eventType ?? body?.statusSummary ?? null,
      occurred_at: occurred,
      // USPS doesn't provide an event id. Synthesize from (timestamp + type).
      carrier_event_id: stage?.eventTimestamp && stage?.eventType
        ? `${stage.eventTimestamp}:${stage.eventType}`
        : null,
      raw_payload: body,
      source: 'poll',
      eta: body?.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : null,
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const creds = await this.integrations.getCredentials('usps');
    if (!creds) return { ok: false, message: 'Not configured' };
    try {
      await this.getToken(creds);
      return { ok: true, message: 'USPS token obtained' };
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 500) };
    }
  }

  // USPS v3 has no webhook/push channel — polling only.

  // ─── private ───────────────────────────────────────────────────────

  private baseUrl(env: 'test' | 'production'): string {
    return env === 'production' ? 'https://api.usps.com' : 'https://apis-tem.usps.com';
  }

  private async getToken(creds: UspsCreds): Promise<string> {
    const res = await fetch(`${this.baseUrl(creds.environment)}/oauth2/v3/token`, {
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

export const _usps = { mapUspsStatus };
