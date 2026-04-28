import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';
import { IntegrationsService } from '../integrations/integrations.service';
import type { CredentialsFor } from '../integrations/integrations.registry';
import { toDbString } from '../common/money';

/**
 * IFS Clients (ifsclients.com) integration.
 *
 * Phase 1 scope (this file): mirror IFS's shipment dashboard inside
 * AGC Desk so operators can see today's labels without bouncing to
 * ifsclients.com. Read-only.
 *
 * Auth model: every request is a POST with form-data carrying
 * AppUserName, AppPassword, account_id. No bearer token, no refresh
 * — so we just attach the creds to every call. They live encrypted
 * in `integrations.credentials_encrypted` via IntegrationsService.
 *
 * Sync strategy: full reload. IFS's /ca_view_shipment_options.php
 * doesn't expose deltas, so we wipe + reinsert into ifs_shipments
 * inside a transaction on every sync. Per-customer shipment volume
 * is small (≤ a few thousand at most), so the cost is bounded.
 *
 * Cron cadence: 15 min, matching the Aurbitrage + Gmail patterns.
 * Operators can also force a refresh from the /admin/shipments IFS
 * tab via runSync().
 */

interface IfsApiResponse<T = unknown> {
  status?: 'success' | 'error' | string;
  message?: string;
  data?: T;
  // IFS sometimes returns the payload at the top level instead of
  // nested under `data`. We flatten both shapes.
  [key: string]: unknown;
}

export interface SyncResult {
  ok: boolean;
  message: string;
  count: number;
  synced_at: string;
}

export interface IfsShipmentRow {
  id: string;
  ifs_shipment_id: string;
  tracking_number: string | null;
  carrier: string | null;
  service_type: string | null;
  label_status: string | null;
  recipient_name: string | null;
  recipient_company: string | null;
  recipient_address: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_zip: string | null;
  recipient_country: string | null;
  declared_value: number | null;
  cost: number | null;
  ship_date: string | null;
  delivered_at: string | null;
  voided_at: string | null;
  label_url: string | null;
  tracking_url: string | null;
  reference: string | null;
  synced_at: string;
}

@Injectable()
export class IfsService {
  private readonly logger = new Logger(IfsService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly integrations: IntegrationsService,
  ) {}

  async isAvailable(): Promise<boolean> {
    const creds = (await this.integrations.getCredentials(
      'ifs',
    )) as CredentialsFor<'ifs'> | null;
    return Boolean(creds?.app_user_name && creds?.app_password && creds?.account_id);
  }

  /**
   * Admin "Test connection" — calls the lightest endpoint (basic_data
   * #2) with the saved credentials. Returns ok/message in the same
   * shape every other provider's testConnection uses.
   */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const creds = (await this.integrations.getCredentials(
      'ifs',
    )) as CredentialsFor<'ifs'> | null;
    if (!creds) return { ok: false, message: 'Not configured' };
    try {
      const res = await this.callIfs(creds, 'ca_basic_data.php');
      // IFS doesn't return a clean 'success' flag uniformly. Treat
      // a non-empty 200 response as success; surface the message
      // when one's present.
      if (res.status === 'error') {
        return { ok: false, message: res.message ?? 'IFS returned error' };
      }
      return {
        ok: true,
        message: `OK · acct ${creds.account_id}`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message.slice(0, 500) };
    }
  }

  /**
   * Cron entrypoint. Fires every 15 min on the dot; no-op when the
   * integration isn't configured (cold installs / disabled). Wraps
   * runSync so a thrown error doesn't bring down the scheduler.
   */
  @Cron('0 */15 * * * *', { name: 'ifs-sync' })
  async scheduledSync(): Promise<void> {
    if (!(await this.isAvailable())) return;
    try {
      const r = await this.runSync();
      this.logger.log(
        `IFS sync: ${r.ok ? 'ok' : 'error'} · ${r.count} shipments`,
      );
    } catch (err) {
      this.logger.error(
        `IFS sync failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Pull the full shipment list from IFS, replace the local cache
   * inside a transaction, and update the singleton sync_state row.
   */
  async runSync(): Promise<SyncResult> {
    const creds = (await this.integrations.getCredentials(
      'ifs',
    )) as CredentialsFor<'ifs'> | null;
    if (!creds) {
      throw new BadRequestException('IFS not configured');
    }

    let payload: IfsApiResponse;
    try {
      // The view-shipment-options endpoint returns the operator's
      // shipment list. IFS hasn't documented filtering params in the
      // postman collection, so we pull the default window (most-
      // recent N) and rely on full reload.
      payload = await this.callIfs(creds, 'ca_view_shipment_options.php');
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await this.recordSyncState({ ok: false, message: msg, count: 0 });
      throw new BadRequestException(`IFS fetch failed: ${msg}`);
    }

    if (payload.status === 'error') {
      const msg = String(payload.message ?? 'IFS returned error');
      await this.recordSyncState({ ok: false, message: msg, count: 0 });
      throw new BadRequestException(`IFS returned error: ${msg}`);
    }

    // The exact field names depend on IFS's response shape. Walk a
    // few common locations to find the shipment array — IFS's
    // postman docs list the endpoints but not the response shapes.
    // We accept any of: payload.data (object with shipments),
    // payload.shipments, payload.data.shipments, top-level array.
    const rawList = this.extractShipmentArray(payload);
    if (!Array.isArray(rawList)) {
      const msg = 'Unexpected IFS response — no shipment array found';
      await this.recordSyncState({ ok: false, message: msg, count: 0 });
      throw new BadRequestException(msg);
    }

    const inserts = rawList
      .map((raw) => this.mapShipmentRow(raw))
      .filter((r): r is NonNullable<ReturnType<typeof this.mapShipmentRow>> => r !== null);

    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('ifs_shipments').execute();
      // Postgres parameter cap: chunk at 1000 rows per insert (each
      // row has ~22 cols, so ~22k params per chunk — well under the
      // 65k ceiling).
      for (let i = 0; i < inserts.length; i += 1000) {
        await trx
          .insertInto('ifs_shipments')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .values(inserts.slice(i, i + 1000) as any)
          .execute();
      }
    });

    const result: SyncResult = {
      ok: true,
      message: `Synced ${inserts.length} shipments`,
      count: inserts.length,
      synced_at: new Date().toISOString(),
    };
    await this.recordSyncState({
      ok: true,
      message: result.message,
      count: inserts.length,
    });
    return result;
  }

  /** Browse the locally cached IFS shipments. */
  async listShipments(opts: { limit?: number; search?: string } = {}): Promise<IfsShipmentRow[]> {
    let q = this.db
      .selectFrom('ifs_shipments')
      .selectAll()
      .orderBy('ship_date', 'desc')
      .orderBy('synced_at', 'desc')
      .limit(opts.limit ?? 500);
    if (opts.search?.trim()) {
      const needle = `%${opts.search.trim().toLowerCase()}%`;
      q = q.where((eb) =>
        eb.or([
          sql<boolean>`lower(coalesce(tracking_number,'')) like ${needle}`,
          sql<boolean>`lower(coalesce(recipient_name,'')) like ${needle}`,
          sql<boolean>`lower(coalesce(recipient_company,'')) like ${needle}`,
          sql<boolean>`lower(coalesce(recipient_city,'')) like ${needle}`,
          sql<boolean>`lower(coalesce(reference,'')) like ${needle}`,
        ]),
      );
    }
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      ifs_shipment_id: r.ifs_shipment_id,
      tracking_number: r.tracking_number,
      carrier: r.carrier,
      service_type: r.service_type,
      label_status: r.label_status,
      recipient_name: r.recipient_name,
      recipient_company: r.recipient_company,
      recipient_address: r.recipient_address,
      recipient_city: r.recipient_city,
      recipient_state: r.recipient_state,
      recipient_zip: r.recipient_zip,
      recipient_country: r.recipient_country,
      declared_value:
        r.declared_value !== null ? Number(r.declared_value) : null,
      cost: r.cost !== null ? Number(r.cost) : null,
      ship_date: r.ship_date,
      delivered_at: r.delivered_at ? r.delivered_at.toString() : null,
      voided_at: r.voided_at ? r.voided_at.toString() : null,
      label_url: r.label_url,
      tracking_url: r.tracking_url,
      reference: r.reference,
      synced_at: r.synced_at.toString(),
    }));
  }

  async getSyncState(): Promise<{
    last_synced_at: string | null;
    last_sync_status: string | null;
    last_sync_message: string | null;
    last_sync_count: number | null;
    configured: boolean;
  }> {
    const row = await this.db
      .selectFrom('ifs_sync_state')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirst();
    return {
      last_synced_at: row?.last_synced_at ? row.last_synced_at.toString() : null,
      last_sync_status: row?.last_sync_status ?? null,
      last_sync_message: row?.last_sync_message ?? null,
      last_sync_count: row?.last_sync_count ?? null,
      configured: await this.isAvailable(),
    };
  }

  // --- internals ---

  /**
   * Call an IFS endpoint with form-data auth. IFS expects every
   * request to be POST with the credentials in the body, so this is
   * the single transport helper. 30s timeout matches our other
   * outbound integrations.
   */
  private async callIfs(
    creds: CredentialsFor<'ifs'>,
    endpoint: string,
    extra: Record<string, string> = {},
  ): Promise<IfsApiResponse> {
    const url = `${creds.url.replace(/\/$/, '')}/${endpoint}`;
    const form = new URLSearchParams();
    form.set('AppUserName', creds.app_user_name);
    form.set('AppPassword', creds.app_password);
    form.set('account_id', creds.account_id);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'AGC-Desk/1.0 (+https://agcdesk.com)',
        },
        body: form.toString(),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
        );
      }
      // Parse — most endpoints return JSON, but if IFS ever returns
      // HTML on auth failure, surface the first chunk so the operator
      // can diagnose.
      try {
        return JSON.parse(text) as IfsApiResponse;
      } catch {
        throw new Error(
          `IFS returned non-JSON: ${text.slice(0, 200)}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * IFS's response shape isn't documented in the postman collection
   * — so we walk the tree looking for the first array of objects
   * that looks like shipments. Common locations checked:
   *   - payload.shipments
   *   - payload.data
   *   - payload.data.shipments
   *   - payload (top-level array)
   *   - any first-level array key
   */
  private extractShipmentArray(payload: IfsApiResponse): unknown[] | null {
    if (Array.isArray(payload)) return payload as unknown[];
    if (Array.isArray((payload as Record<string, unknown>).shipments))
      return (payload as { shipments: unknown[] }).shipments;
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.shipments)) return d.shipments;
      // First array value found inside data.
      for (const v of Object.values(d)) {
        if (Array.isArray(v)) return v;
      }
    }
    // Last resort: scan top-level keys for an array.
    for (const v of Object.values(payload)) {
      if (Array.isArray(v)) return v;
    }
    return null;
  }

  /**
   * Translate one raw IFS shipment object into the local-table row
   * shape. IFS uses snake_case in their forms but camelCase in some
   * response variants — we accept both via the field-fallback chain.
   * Skips rows that don't have at minimum an ifs_shipment_id /
   * tracking_no — those would violate the unique constraint.
   */
  private mapShipmentRow(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const get = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = r[k];
        if (v !== undefined && v !== null && v !== '') return String(v);
      }
      return null;
    };
    const num = (...keys: string[]): string | null => {
      const s = get(...keys);
      if (s === null) return null;
      const n = Number(s.toString().replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? toDbString(n) : null;
    };

    const ifsId =
      get('shipment_id', 'shipmentId', 'id') ??
      get('tracking_no', 'tracking_number', 'trackingNo');
    if (!ifsId) return null;

    return {
      ifs_shipment_id: ifsId,
      tracking_number: get('tracking_no', 'tracking_number', 'trackingNo'),
      carrier: get('service_type', 'carrier', 'courier'),
      service_type: get('service_type', 'serviceType', 'service'),
      label_status: get('status', 'label_status', 'labelStatus'),
      sender_name: get('ca_label_name', 'sender_name', 'senderName'),
      sender_company: get('ca_company_name', 'sender_company'),
      sender_address: get('ca_address1', 'sender_address'),
      recipient_name: get('client_label_name', 'recipient_name', 'recipientName'),
      recipient_company: get('client_name', 'recipient_company'),
      recipient_address: get('client_address1', 'recipient_address'),
      recipient_city: get('client_city', 'recipient_city'),
      recipient_state: get('client_state', 'recipient_state'),
      recipient_zip: get('client_zip', 'recipient_zip'),
      recipient_country: get('client_country', 'recipient_country'),
      declared_value: num('declare_value', 'declared_value', 'insurance'),
      cost: num('cost', 'shipment_cost', 'total_cost'),
      ship_date: get('pickup_date', 'ship_date', 'shipDate'),
      delivered_at: null, // IFS exposes this through #28 on a per-shipment basis; not in list view
      voided_at: get('voided_at')
        ? new Date(get('voided_at') as string)
        : null,
      label_url: get('label_url', 'pdf_url'),
      tracking_url: get('tracking_url'),
      reference: get('reference'),
      raw_payload: sql`${JSON.stringify(r)}::jsonb`,
    };
  }

  private async recordSyncState(args: {
    ok: boolean;
    message: string;
    count: number;
  }): Promise<void> {
    await this.db
      .insertInto('ifs_sync_state')
      .values({
        id: 1,
        last_synced_at: new Date(),
        last_sync_status: args.ok ? 'ok' : 'error',
        last_sync_message: args.message.slice(0, 500),
        last_sync_count: args.count,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          last_synced_at: new Date(),
          last_sync_status: args.ok ? 'ok' : 'error',
          last_sync_message: args.message.slice(0, 500),
          last_sync_count: args.count,
        }),
      )
      .execute();
  }
}
