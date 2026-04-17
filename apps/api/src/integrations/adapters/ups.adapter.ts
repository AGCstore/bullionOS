import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../integrations.service';
import type { CredentialsFor } from '../integrations.registry';
import type { NormalizedTrackingUpdate, ShipmentAdapter, WebhookVerification } from '../shipment-adapter';
import type { ShipmentStatus } from '../../db/types';

type UpsCreds = CredentialsFor<'ups'>;

interface UpsTrackResponse {
  trackResponse?: {
    shipment?: Array<{
      package?: Array<{
        activity?: Array<{
          status?: { type?: string; description?: string; code?: string };
          date?: string; // YYYYMMDD
          time?: string; // HHMMSS
          gmtDate?: string;
          gmtTime?: string;
        }>;
        deliveryDate?: Array<{ date?: string }>;
      }>;
    }>;
  };
}

@Injectable()
export class UpsAdapter implements ShipmentAdapter {
  readonly name = 'ups' as const;

  constructor(private readonly integrations: IntegrationsService) {}

  async track(trackingNumber: string): Promise<NormalizedTrackingUpdate | null> {
    const creds = await this.integrations.getCredentials('ups');
    if (!creds) return null;

    const token = await this.getToken(creds);
    const res = await fetch(
      `${this.baseUrl(creds.environment)}/api/track/v1/details/${encodeURIComponent(trackingNumber)}`,
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
    const occurredAt = parseUpsTimestamp(latest?.gmtDate, latest?.gmtTime, latest?.date, latest?.time);

    return {
      carrier: 'ups',
      tracking_number: trackingNumber,
      status: mapUpsStatus(code),
      description: latest?.status?.description ?? null,
      occurred_at: occurredAt ?? new Date(),
      // UPS doesn't emit a first-class event id; use (date || code) + index as a weak key
      // so repeat polls of the same latest event are at least deduped-best-effort.
      carrier_event_id: latest?.status?.code
        ? `${latest.gmtDate ?? latest.date ?? ''}${latest.gmtTime ?? latest.time ?? ''}:${latest.status.code}`
        : null,
      raw_payload: body,
      source: 'poll',
      eta: pkg?.deliveryDate?.[0]?.date ? parseYmd(pkg.deliveryDate[0].date) : null,
    };
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const creds = await this.integrations.getCredentials('ups');
    if (!creds) return { ok: false, message: 'Not configured' };
    try {
      await this.getToken(creds);
      return { ok: true, message: 'UPS token obtained' };
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 500) };
    }
  }

  // UPS does offer webhooks ("Quantum View"), but they require enterprise setup.
  // Leaving verify/parse unimplemented — the polling path carries the load.

  // ─── private ───────────────────────────────────────────────────────

  private baseUrl(env: 'cie' | 'production'): string {
    return env === 'production' ? 'https://onlinetools.ups.com' : 'https://wwwcie.ups.com';
  }

  private async getToken(creds: UpsCreds): Promise<string> {
    const auth = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
    const res = await fetch(`${this.baseUrl(creds.environment)}/security/v1/oauth/token`, {
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
}

// UPS activity type codes → our internal statuses.
function mapUpsStatus(code: string): ShipmentStatus {
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

function parseYmd(s: string): Date | null {
  if (!/^\d{8}$/.test(s)) return null;
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
}

function parseUpsTimestamp(
  gmtDate?: string,
  gmtTime?: string,
  localDate?: string,
  localTime?: string,
): Date | null {
  const d = gmtDate ?? localDate;
  const t = gmtTime ?? localTime;
  if (!d || !/^\d{8}$/.test(d)) return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${
    t && /^\d{6}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : '00:00:00'
  }${gmtDate ? 'Z' : ''}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Exported for tests.
export const _ups = { mapUpsStatus, parseYmd, parseUpsTimestamp };
