'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { ShipmentStatusBadge } from '@/components/status-pill';
import { useAuth } from '@/lib/auth-context';

interface AdminShipment {
  id: string;
  invoice_id: string;
  invoice_number: string;
  client_name: string;
  carrier: 'ups' | 'fedex' | 'usps' | 'other';
  tracking_number: string | null;
  /** Carrier-specific service level (migration 021, ticket SHIP-001). */
  delivery_speed: string | null;
  tracking_url: string | null;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
}

type Carrier = AdminShipment['carrier'];

const STATUS_OPTIONS = [
  { value: 'label_created', label: 'Label created' },
  { value: 'in_transit', label: 'In transit' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'exception', label: 'Exception' },
  { value: 'returned', label: 'Returned' },
] as const;

interface IfsShipment {
  id: string;
  ifs_shipment_id: string;
  tracking_number: string | null;
  carrier: string | null;
  service_type: string | null;
  label_status: string | null;
  recipient_name: string | null;
  recipient_company: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_zip: string | null;
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

interface IfsState {
  configured: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  last_sync_count: number | null;
}

export default function AdminShipmentsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data } = useQuery({
    queryKey: ['admin', 'shipments'],
    queryFn: () => apiFetch<AdminShipment[]>('/admin/shipments'),
    refetchInterval: 30_000,
  });
  // IFS dashboard mirror — fetched alongside the local shipments
  // table. Same 30s refetch keeps both views in sync; admins can
  // also force a re-pull via the IFS card's Refresh button.
  const { data: ifsState } = useQuery<IfsState>({
    queryKey: ['admin', 'ifs', 'state'],
    queryFn: () => apiFetch<IfsState>('/admin/ifs/state'),
    refetchInterval: 30_000,
  });
  const [ifsSearch, setIfsSearch] = useState('');
  const { data: ifsShipments = [], isLoading: ifsLoading } = useQuery<
    IfsShipment[]
  >({
    queryKey: ['admin', 'ifs', 'shipments', ifsSearch],
    queryFn: () =>
      apiFetch<IfsShipment[]>(
        `/admin/ifs/shipments${ifsSearch.trim() ? `?q=${encodeURIComponent(ifsSearch.trim())}` : ''}`,
      ),
  });
  const ifsSync = useMutation<
    { ok: boolean; count: number; message: string },
    ApiError,
    void
  >({
    mutationFn: () =>
      apiFetch<{ ok: boolean; count: number; message: string }>(
        '/admin/ifs/sync',
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'ifs'] });
    },
  });

  // Delivery-speed whitelist — single fetch, shared across rows (SHIP-001).
  const { data: speeds } = useQuery({
    queryKey: ['admin', 'shipments', 'delivery-speeds'],
    queryFn: () =>
      apiFetch<Record<Carrier, string[]>>('/admin/shipments/delivery-speeds'),
    staleTime: Infinity,
  });

  // Manual carrier-poll trigger. Background cron runs every 2 min; this
  // button is for operators who just entered a tracking number and want
  // immediate confirmation the carrier sees it.
  const [polling, setPolling] = useState(false);
  const [pollFlash, setPollFlash] = useState<string | null>(null);
  async function pollNow() {
    setPolling(true);
    setPollFlash(null);
    try {
      const res = await apiFetch<{
        scanned: number;
        updated: number;
        failed: number;
        skipped: number;
      }>('/admin/shipments/poll-now', { method: 'POST' });
      setPollFlash(
        `Scanned ${res.scanned} · updated ${res.updated}` +
          (res.failed > 0 ? ` · ${res.failed} failed` : ''),
      );
      await qc.invalidateQueries({ queryKey: ['admin', 'shipments'] });
    } catch (err) {
      setPollFlash(err instanceof ApiError ? err.message : 'Poll failed');
    } finally {
      setPolling(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Shipments</h1>
          <p className="mt-1 text-sm text-ink-400">
            Shipments are created from the invoice detail page. Status
            auto-refreshes from the carrier every 2 minutes.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={pollNow}
            disabled={polling}
            className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium hover:bg-ink-50 disabled:opacity-60"
            title="Ask every carrier for the latest tracking now, instead of waiting for the 2-min cron."
          >
            {polling ? 'Polling…' : 'Refresh from carriers'}
          </button>
          {pollFlash && (
            <span className="text-[11px] text-ink-500">{pollFlash}</span>
          )}
        </div>
      </div>

      {/* IFS dashboard mirror. Hidden when the integration isn't
          configured so the page doesn't show a misleading empty
          card to operators who haven't set up creds yet. */}
      {ifsState?.configured && (
        <IfsPanel
          state={ifsState}
          shipments={ifsShipments}
          loading={ifsLoading}
          search={ifsSearch}
          onSearch={setIfsSearch}
          onSync={() => ifsSync.mutate()}
          syncing={ifsSync.isPending}
          syncError={ifsSync.error?.message ?? null}
          syncResult={ifsSync.data ?? null}
          isAdmin={isAdmin}
        />
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink-900">
        Linked to invoices
      </h2>
      <p className="mt-1 text-xs text-ink-500">
        Shipments AGC Desk created against an invoice (carrier-tracked
        in real time). IFS-only labels not linked to an AGC invoice
        appear above.
      </p>

      {/* MOB-002: wide table scrolls horizontally on narrow viewports
          instead of clipping. min-w keeps columns legible. */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Carrier</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Tracking</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((s) => (
              <ShipmentRow key={s.id} s={s} speeds={speeds ?? null} />
            ))}
            {(!data || data.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-400">
                  No shipments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * IFS dashboard mirror. Renders the FedEx-reseller's shipment list
 * pulled via the IFS API + cached locally for fast browsing.
 * Synced every 15 min via cron; admins can force a refresh.
 */
function IfsPanel({
  state,
  shipments,
  loading,
  search,
  onSearch,
  onSync,
  syncing,
  syncError,
  syncResult,
  isAdmin,
}: {
  state: IfsState;
  shipments: IfsShipment[];
  loading: boolean;
  search: string;
  onSearch: (q: string) => void;
  onSync: () => void;
  syncing: boolean;
  syncError: string | null;
  syncResult: { ok: boolean; count: number; message: string } | null;
  isAdmin: boolean;
}) {
  const lastSynced = state.last_synced_at
    ? formatRelative(state.last_synced_at)
    : '—';
  const errored = state.last_sync_status === 'error';
  return (
    <section className="mt-6 rounded-xl border border-ink-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 p-4">
        <div>
          <h2 className="text-base font-semibold text-ink-900">
            IFS labels
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Mirror of your{' '}
            <a
              href="https://www.ifsclients.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              ifsclients.com
            </a>{' '}
            shipment dashboard. Synced every 15 min · last sync{' '}
            <span className={errored ? 'text-amber-700' : 'text-ink-700'}>
              {lastSynced}
            </span>
            {state.last_sync_count !== null &&
              ` · ${state.last_sync_count} shipments`}
          </p>
          {errored && state.last_sync_message && (
            <p className="mt-1 text-[11px] text-amber-700">
              Last error: {state.last_sync_message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={onSync}
              disabled={syncing}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium hover:bg-ink-50 disabled:opacity-60"
            >
              {syncing ? 'Refreshing…' : 'Refresh now'}
            </button>
          )}
        </div>
      </header>

      {syncError && (
        <div className="border-b border-ink-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {syncError}
        </div>
      )}
      {syncResult && (
        <div className="border-b border-ink-100 bg-green-50 px-4 py-2 text-xs text-green-700">
          {syncResult.message}
        </div>
      )}

      <div className="border-b border-ink-100 px-4 py-2">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter — tracking, recipient, city, reference…"
          className="w-full rounded-md border border-ink-200 px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none focus:ring-1 focus:ring-ink-900"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-4 py-3">Tracking</th>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3 text-right">Declared</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && shipments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && shipments.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-ink-400">
                  {search.trim()
                    ? `No IFS shipments match "${search}".`
                    : 'No IFS shipments synced yet. Hit Refresh now to pull the latest.'}
                </td>
              </tr>
            )}
            {shipments.map((s) => (
              <IfsRow key={s.id} s={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IfsRow({ s }: { s: IfsShipment }) {
  const recipient =
    [s.recipient_company, s.recipient_name].filter(Boolean).join(' / ') ||
    '—';
  const where = [s.recipient_city, s.recipient_state].filter(Boolean).join(', ');
  const status = s.label_status ?? '—';
  const isVoid = /void/i.test(status);
  return (
    <tr className="border-t border-ink-100">
      <td className="px-4 py-3 font-mono text-xs">
        {s.tracking_url && s.tracking_number ? (
          <a
            href={s.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {s.tracking_number}
          </a>
        ) : (
          s.tracking_number ?? '—'
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-ink-900">{recipient}</div>
        {where && <div className="text-[11px] text-ink-400">{where}</div>}
      </td>
      <td className="px-4 py-3 text-xs text-ink-700">
        {s.service_type ?? s.carrier ?? '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono tabular-nums">
        {s.declared_value !== null
          ? `$${s.declared_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono tabular-nums">
        {s.cost !== null
          ? `$${s.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-ink-700">{s.ship_date ?? '—'}</td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isVoid
              ? 'bg-red-100 text-red-700'
              : 'bg-green-100 text-green-700'
          }`}
        >
          {status}
        </span>
        {s.label_url && (
          <a
            href={s.label_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 text-[11px] text-ink-500 underline-offset-2 hover:underline"
          >
            label ↗
          </a>
        )}
      </td>
    </tr>
  );
}

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const sec = Math.max(0, Math.floor(diff / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  } catch {
    return iso;
  }
}

function ShipmentRow({
  s,
  speeds,
}: {
  s: AdminShipment;
  speeds: Record<Carrier, string[]> | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(s.tracking_number ?? '');
  const [deliverySpeed, setDeliverySpeed] = useState(s.delivery_speed ?? '');
  const [status, setStatus] = useState(s.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carrierSpeeds = speeds?.[s.carrier] ?? [];
  // If the saved speed isn't in the current whitelist (e.g. the whitelist
  // changed after the row was created), still render it in the dropdown
  // so the operator sees what's stored rather than an empty-looking row.
  const dropdownSpeeds =
    deliverySpeed && !carrierSpeeds.includes(deliverySpeed)
      ? [deliverySpeed, ...carrierSpeeds]
      : carrierSpeeds;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        tracking_number: tracking || undefined,
        status: status !== s.status ? status : undefined,
      };
      // Only send delivery_speed when it actually changed — sending the
      // same value is a no-op server-side but costs a round-trip on the
      // validator. Empty string means "clear it".
      if ((s.delivery_speed ?? '') !== deliverySpeed) {
        patch.delivery_speed = deliverySpeed || undefined;
      }
      await apiFetch(`/admin/shipments/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await qc.invalidateQueries({ queryKey: ['admin', 'shipments'] });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-ink-200 align-top">
      <td className="px-4 py-3 font-mono">
        <Link href={`/admin/invoices/${s.invoice_id}`} className="hover:underline">
          {s.invoice_number}
        </Link>
      </td>
      <td className="px-4 py-3">{s.client_name}</td>
      <td className="px-4 py-3 uppercase">{s.carrier}</td>
      <td className="px-4 py-3 text-xs">
        {editing ? (
          <select
            value={deliverySpeed}
            onChange={(e) => setDeliverySpeed(e.target.value)}
            disabled={carrierSpeeds.length === 0}
            className="input w-44 text-xs"
          >
            <option value="">
              {carrierSpeeds.length === 0 ? '— n/a —' : '— service —'}
            </option>
            {dropdownSpeeds.map((speed) => (
              <option key={speed} value={speed}>
                {speed}
              </option>
            ))}
          </select>
        ) : s.delivery_speed ? (
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700">
            {s.delivery_speed}
          </span>
        ) : (
          <span className="text-ink-400">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs">
        {editing ? (
          <input
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            className="input w-40 font-mono text-xs"
            placeholder="1Z..."
          />
        ) : s.tracking_url ? (
          <a
            href={s.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-900 underline-offset-2 hover:underline"
          >
            {s.tracking_number ?? '—'}
          </a>
        ) : (
          s.tracking_number ?? <span className="text-ink-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input text-xs"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <ShipmentStatusBadge status={s.status} />
        )}
        {error && <div className="mt-1 text-xs text-red-700">{error}</div>}
      </td>
      <td className="px-4 py-3 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-ink-200 px-2 py-1 text-xs"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-ink-900 px-2 py-1 text-xs text-white"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50"
          >
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}
