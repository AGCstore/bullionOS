'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

/**
 * RARCOA daily pricing tab.
 *
 * Replaces the "copy the emailed PDF into a Google Sheet" workflow
 * (AGC.RARCOA REF SHEET). Admin uploads the daily PDF; backend
 * parses it into a structured snapshot; this page renders:
 *
 *   - Upload dropzone (admin only)
 *   - Header: as-of date + time + basis gold (compared to today's
 *     live spot so operators can sanity-check "is this fresh?")
 *   - 4 section tables:
 *       • Uncertified gold (small) — VF/XF/AU/BU
 *       • Uncertified gold (large) — LP/LT POL / VF/XF / AU/CU / Uncirculated
 *       • Certified gold — MS61-MS66 (rendered with both clean + w/Spots
 *         columns, the way Sheet1 of the Google Sheet did)
 *       • Silver dollars — Morgan NGC, Morgan PCGS, Peace NGC, Peace PCGS
 *         × MS-63..MS-67, with a Clean/Toned toggle
 *   - History picker to switch to a prior day's sheet.
 *
 * Every AGC-marked-down price comes from the server's rarcoa-markdowns
 * table (derived directly from the operator's Google Sheet formulas).
 * Phase 2 will hook up the email listener so uploads become automatic.
 */

type Section =
  | 'uncertified_gold'
  | 'uncertified_large_gold'
  | 'certified_gold'
  | 'morgan_dollar'
  | 'peace_dollar';

interface Cell {
  section: Section;
  product: string;
  grade: string;
  raw_bid: number | null;
  raw_ask: number | null;
  ngc_only: boolean;
  agc_clean: number | null;
  agc_spots: number | null;
  agc_toned: number | null;
}

interface Snapshot {
  sheet_id: string | null;
  as_of_date: string | null;
  as_of_time: string | null;
  basis_gold: number | null;
  ingested_at: string | null;
  ingested_by_user_id: string | null;
  cells: Cell[];
}

interface SheetRow {
  id: string;
  as_of_date: string;
  as_of_time: string | null;
  basis_gold: number | null;
  ingested_at: string;
}

interface GmailStatus {
  configured: boolean;
  authorized: boolean;
  enabled: boolean;
  mailbox: string | null;
  poll_interval_minutes: number | null;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
}

interface PollResult {
  checked: boolean;
  matched: number;
  ingested: number;
  details: Array<{
    message_id: string;
    from: string | null;
    subject: string | null;
    internal_date: string | null;
    outcome: 'ingested' | 'skipped-no-pdf' | 'skipped-parse-fail' | 'error';
    as_of_date?: string | null;
    error?: string | null;
  }>;
  skipped_reason?: string;
}

export default function RarcoaPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data: history = [] } = useQuery<SheetRow[]>({
    queryKey: ['admin', 'rarcoa', 'history'],
    queryFn: () => apiFetch<SheetRow[]>('/admin/rarcoa'),
  });

  const queryKey = ['admin', 'rarcoa', 'snapshot', selectedDate ?? 'latest'];
  const { data: snapshot, isLoading } = useQuery<Snapshot>({
    queryKey,
    queryFn: () =>
      apiFetch<Snapshot>(
        selectedDate
          ? `/admin/rarcoa/by-date?date=${encodeURIComponent(selectedDate)}`
          : '/admin/rarcoa/latest',
      ),
  });

  const upload = useMutation<Snapshot, ApiError, File>({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiFetch<Snapshot>('/admin/rarcoa/upload', {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: (snap) => {
      setFlash(
        `Ingested ${snap.cells.length} price rows for ${snap.as_of_date}.`,
      );
      setErr(null);
      setSelectedDate(null); // jump back to "latest" view
      qc.invalidateQueries({ queryKey: ['admin', 'rarcoa'] });
    },
    onError: (e) => {
      setFlash(null);
      setErr(e instanceof ApiError ? e.message : 'Upload failed');
    },
  });

  const deleteMut = useMutation<void, ApiError, string>({
    mutationFn: (id: string) =>
      apiFetch(`/admin/rarcoa/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'rarcoa'] }),
  });

  // Gmail auto-ingest status + manual poll. Pulled alongside the rarcoa
  // queries so the admin can see at a glance whether auto-ingest is
  // configured, authorized, and when the next check is likely to fire.
  const { data: gmailStatus } = useQuery<GmailStatus>({
    queryKey: ['admin', 'gmail', 'status'],
    queryFn: () => apiFetch<GmailStatus>('/admin/integrations/gmail/status'),
    // Re-poll the status after authorization / test-connection changes.
    refetchInterval: 60_000,
  });
  const pollMut = useMutation<PollResult, ApiError, void>({
    mutationFn: () =>
      apiFetch<PollResult>('/admin/integrations/gmail/poll', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.ingested > 0) {
        setFlash(`Auto-ingested ${r.ingested} sheet${r.ingested === 1 ? '' : 's'} from Gmail.`);
        qc.invalidateQueries({ queryKey: ['admin', 'rarcoa'] });
      }
      qc.invalidateQueries({ queryKey: ['admin', 'gmail', 'status'] });
    },
  });

  const bySection = useMemo(() => {
    const m: Record<Section, Cell[]> = {
      uncertified_gold: [],
      uncertified_large_gold: [],
      certified_gold: [],
      morgan_dollar: [],
      peace_dollar: [],
    };
    for (const c of snapshot?.cells ?? []) m[c.section]?.push(c);
    return m;
  }, [snapshot]);

  return (
    <div className="mx-auto max-w-6xl">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
        <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gold-500" />
        <div className="p-5 md:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            Wholesale supplier
          </div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink-900">
            RARCOA Goldsheet
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-500">
            Daily bid/ask indications from RARCOA (
            <a
              href="https://rarcoa.com"
              className="underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              rarcoa.com
            </a>
            ). Upload the PDF they email to sales@ and the in-store AGC
            pricing (Sheet1 equivalent) is computed automatically.
          </p>
          {snapshot && snapshot.as_of_date && (
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-ink-100 pt-4 md:grid-cols-4">
              <Metric
                label="Sheet date"
                value={formatDate(snapshot.as_of_date)}
              />
              <Metric
                label="Quote time"
                value={snapshot.as_of_time ?? '—'}
              />
              <Metric
                label="Basis gold"
                value={
                  snapshot.basis_gold !== null
                    ? `$${snapshot.basis_gold.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : '—'
                }
                mono
              />
              <Metric
                label="Ingested"
                value={
                  snapshot.ingested_at
                    ? new Date(snapshot.ingested_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '—'
                }
              />
            </div>
          )}
        </div>
      </section>

      {/* Upload */}
      {isAdmin && (
        <UploadCard
          onFile={(f) => upload.mutate(f)}
          busy={upload.isPending}
          flash={flash}
          error={err}
        />
      )}

      {/* Gmail auto-ingest status */}
      {gmailStatus && (
        <GmailStatusCard
          status={gmailStatus}
          onPoll={() => pollMut.mutate()}
          polling={pollMut.isPending}
          result={pollMut.data ?? null}
          error={pollMut.error?.message ?? null}
        />
      )}

      {/* History picker */}
      {history.length > 1 && (
        <section className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-white p-3 text-xs">
          <span className="text-ink-500">History:</span>
          <button
            onClick={() => setSelectedDate(null)}
            className={`rounded-md border px-2 py-1 ${
              selectedDate === null
                ? 'border-ink-900 bg-ink-900 text-white'
                : 'border-ink-200 text-ink-600 hover:text-ink-900'
            }`}
          >
            Latest
          </button>
          {history.slice(0, 20).map((h) => (
            <button
              key={h.id}
              onClick={() => setSelectedDate(h.as_of_date)}
              className={`rounded-md border px-2 py-1 ${
                selectedDate === h.as_of_date
                  ? 'border-ink-900 bg-ink-900 text-white'
                  : 'border-ink-200 text-ink-600 hover:text-ink-900'
              }`}
              title={`Basis ${
                h.basis_gold !== null ? '$' + h.basis_gold.toFixed(2) : '—'
              }`}
            >
              {formatDate(h.as_of_date)}
            </button>
          ))}
          {isAdmin && selectedDate && (
            <button
              onClick={() => {
                const row = history.find((h) => h.as_of_date === selectedDate);
                if (row && confirm(`Delete the RARCOA sheet for ${formatDate(row.as_of_date)}?`))
                  deleteMut.mutate(row.id);
              }}
              className="ml-auto rounded-md border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
            >
              Delete this day
            </button>
          )}
        </section>
      )}

      {/* Loading / empty states */}
      {isLoading && !snapshot && (
        <div className="mt-6 rounded-xl border border-ink-200 bg-white p-12 text-center text-sm text-ink-400">
          Loading…
        </div>
      )}
      {!isLoading && snapshot && !snapshot.as_of_date && (
        <div className="mt-6 rounded-xl border border-ink-200 bg-white p-12 text-center text-sm text-ink-400">
          No RARCOA sheet ingested yet. Upload today&apos;s PDF to get started.
        </div>
      )}

      {/* Section tables */}
      {snapshot && snapshot.as_of_date && (
        <>
          <SectionCard
            title="Uncertified gold · small"
            subtitle="VF / XF / AU / BU — AGC pays 82% of RARCOA bid."
            cells={bySection.uncertified_gold}
            columns={['VF', 'XF', 'AU', 'BU']}
            showSpots={false}
          />
          <SectionCard
            title="Uncertified gold · large"
            subtitle="$5/$10/$20 Liberty + St. Gaudens. AGC uses its own buy rates for these — shown here for RARCOA reference only."
            cells={bySection.uncertified_large_gold}
            columns={['LP/LT POL', 'VF/XF', 'AU/CU', 'Uncirculated']}
            showSpots={false}
            agcPricesOptional
          />
          <SectionCard
            title="Certified gold · MS61 – MS66"
            subtitle="Each grade has a clean and a w/Spots derived price. Spots typically get 92–98% of the clean AGC price."
            cells={bySection.certified_gold}
            columns={['MS61', 'MS62', 'MS63', 'MS64', 'MS65', 'MS66']}
            showSpots
          />
          <SilverCard
            morgan={bySection.morgan_dollar}
            peace={bySection.peace_dollar}
          />
        </>
      )}
    </div>
  );
}

/* ═════════════ Upload card ═════════════ */

function UploadCard({
  onFile,
  busy,
  flash,
  error,
}: {
  onFile: (f: File) => void;
  busy: boolean;
  flash: string | null;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function pick() {
    inputRef.current?.click();
  }

  return (
    <section className="mt-4 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Upload today&apos;s goldsheet</h2>
        <span className="text-xs text-ink-500">
          PDF · up to 3 MB
        </span>
      </div>
      <div
        onClick={pick}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className={`mt-3 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-sm transition ${
          dragOver
            ? 'border-gold-500 bg-gold-500/10 text-ink-900'
            : 'border-ink-200 bg-ink-50/50 text-ink-500 hover:border-gold-500/50 hover:text-ink-700'
        }`}
      >
        {busy
          ? 'Parsing PDF…'
          : 'Drop the RARCOA PDF here, or click to choose a file.'}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {flash && (
        <div className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
          {flash}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}

/* ═════════════ Section table (gold) ═════════════ */

function SectionCard({
  title,
  subtitle,
  cells,
  columns,
  showSpots,
  agcPricesOptional = false,
}: {
  title: string;
  subtitle: string;
  cells: Cell[];
  columns: string[];
  showSpots: boolean;
  /** Some sections have no AGC markdown by design (SEE AG&C BUY RATES). */
  agcPricesOptional?: boolean;
}) {
  // Pivot cells into { product: { grade: cell } }. Preserves first-seen
  // product order which matches the Google Sheet for easy visual diff.
  const { productOrder, byProduct } = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, Record<string, Cell>>();
    for (const c of cells) {
      if (!map.has(c.product)) {
        map.set(c.product, {});
        order.push(c.product);
      }
      map.get(c.product)![c.grade] = c;
    }
    return { productOrder: order, byProduct: map };
  }, [cells]);

  if (productOrder.length === 0) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="border-b border-ink-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              {columns.map((col) => (
                <th
                  key={col}
                  colSpan={showSpots ? 2 : 1}
                  className="px-4 py-3 text-right"
                >
                  {col}
                  {showSpots && (
                    <span className="ml-1 block text-[10px] font-normal normal-case tracking-normal text-ink-400">
                      clean · w/spots
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productOrder.map((product, i) => (
              <tr
                key={product}
                className={`border-t border-ink-100 ${i % 2 === 1 ? 'bg-ink-50/40' : ''}`}
              >
                <td className="px-4 py-3 font-medium text-ink-900">
                  {product}
                </td>
                {columns.map((col) => {
                  const c = byProduct.get(product)?.[col];
                  return (
                    <GoldPriceCell
                      key={col}
                      cell={c}
                      showSpots={showSpots}
                      agcOptional={agcPricesOptional}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GoldPriceCell({
  cell,
  showSpots,
  agcOptional,
}: {
  cell: Cell | undefined;
  showSpots: boolean;
  agcOptional: boolean;
}) {
  if (!cell) {
    return showSpots ? (
      <>
        <td className="px-4 py-3 text-right text-ink-300">—</td>
        <td className="px-4 py-3 text-right text-ink-300">—</td>
      </>
    ) : (
      <td className="px-4 py-3 text-right text-ink-300">—</td>
    );
  }
  return showSpots ? (
    <>
      <td className="px-4 py-3 text-right">
        <AgcPrice value={cell.agc_clean} rawBid={cell.raw_bid} rawAsk={cell.raw_ask} ngc={cell.ngc_only} agcOptional={agcOptional} />
      </td>
      <td className="px-4 py-3 text-right">
        <AgcPrice value={cell.agc_spots} rawBid={cell.raw_bid} rawAsk={cell.raw_ask} ngc={cell.ngc_only} agcOptional={agcOptional} hideRaw />
      </td>
    </>
  ) : (
    <td className="px-4 py-3 text-right">
      <AgcPrice value={cell.agc_clean} rawBid={cell.raw_bid} rawAsk={cell.raw_ask} ngc={cell.ngc_only} agcOptional={agcOptional} />
    </td>
  );
}

/** Shows AGC price (big) + RARCOA bid/ask (small grey). */
function AgcPrice({
  value,
  rawBid,
  rawAsk,
  ngc,
  agcOptional,
  hideRaw = false,
}: {
  value: number | null;
  rawBid: number | null;
  rawAsk: number | null;
  ngc: boolean;
  agcOptional: boolean;
  hideRaw?: boolean;
}) {
  if (value === null && rawBid === null) {
    return <span className="text-ink-300">—</span>;
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span
        className={`font-mono tabular-nums ${
          value !== null ? 'font-semibold text-ink-900' : 'text-ink-400'
        }`}
        title={
          value === null && agcOptional
            ? 'AGC uses its own buy rates for this product.'
            : undefined
        }
      >
        {value !== null
          ? `$${value.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}`
          : agcOptional
            ? 'AGC rates'
            : '—'}
      </span>
      {!hideRaw && (
        <span className="text-[10px] font-mono tabular-nums text-ink-400">
          {ngc && 'NGC '}
          {rawBid !== null ? rawBid : '—'} / {rawAsk !== null ? rawAsk : '—'}
        </span>
      )}
    </span>
  );
}

/* ═════════════ Silver dollar card (Morgan + Peace w/ tone toggle) ═════════════ */

function SilverCard({
  morgan,
  peace,
}: {
  morgan: Cell[];
  peace: Cell[];
}) {
  const [tone, setTone] = useState<'clean' | 'toned'>('clean');
  if (morgan.length === 0 && peace.length === 0) return null;

  const grades = ['MS-63', 'MS-64', 'MS-65', 'MS-66', 'MS-67'];

  const lookup = (rows: Cell[], product: string, house: 'NGC' | 'PCGS') =>
    rows.find((c) => c.product === product && c.grade === house);

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            Certified silver dollars
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Morgan (pre-1921) + Peace. NGC/PCGS × MS-63 to MS-67. AGC
            pays 85% of RARCOA for clean, 75% for toned/tarnished.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-ink-200 bg-ink-50/50 p-0.5 text-xs">
          <button
            onClick={() => setTone('clean')}
            className={`rounded px-3 py-1 ${
              tone === 'clean'
                ? 'bg-white font-semibold text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            Clean
          </button>
          <button
            onClick={() => setTone('toned')}
            className={`rounded px-3 py-1 ${
              tone === 'toned'
                ? 'bg-white font-semibold text-ink-900 shadow-sm'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            Toned
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-ink-50 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3 text-right">Morgan · NGC</th>
              <th className="px-4 py-3 text-right">Morgan · PCGS</th>
              <th className="px-4 py-3 text-right">Peace · NGC</th>
              <th className="px-4 py-3 text-right">Peace · PCGS</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g, i) => {
              const mN = lookup(morgan, g, 'NGC');
              const mP = lookup(morgan, g, 'PCGS');
              const pN = lookup(peace, g, 'NGC');
              const pP = lookup(peace, g, 'PCGS');
              return (
                <tr
                  key={g}
                  className={`border-t border-ink-100 ${
                    i % 2 === 1 ? 'bg-ink-50/40' : ''
                  }`}
                >
                  <td className="px-4 py-3 font-medium text-ink-900">{g}</td>
                  {[mN, mP, pN, pP].map((c, idx) => (
                    <td key={idx} className="px-4 py-3 text-right">
                      <AgcPrice
                        value={
                          c
                            ? tone === 'toned'
                              ? c.agc_toned
                              : c.agc_clean
                            : null
                        }
                        rawBid={c?.raw_bid ?? null}
                        rawAsk={c?.raw_ask ?? null}
                        ngc={c?.ngc_only ?? false}
                        agcOptional={false}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ═════════════ Helpers ═════════════ */

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className={`mt-0.5 text-sm text-ink-900 ${mono ? 'font-mono tabular-nums' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    // Display as the calendar day the sheet was dated, no tz shift.
    const [y, m, d] = iso.split('-');
    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    return dt.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/* ═════════════ Gmail auto-ingest status ═════════════ */

/**
 * Gmail auto-ingest status card. Surfaces:
 *   - whether the Gmail integration is configured/authorized/enabled
 *   - "Check now" button to fire the poll on demand (same path the cron
 *     runs every 15 min — useful when the email just landed)
 *   - per-message outcome list from the most recent poll, so the admin
 *     can see exactly which RARCOA emails were ingested vs skipped
 *   - a short "configure it" CTA when the integration is missing
 */
function GmailStatusCard({
  status,
  onPoll,
  polling,
  result,
  error,
}: {
  status: GmailStatus;
  onPoll: () => void;
  polling: boolean;
  result: PollResult | null;
  error: string | null;
}) {
  const ready = status.configured && status.authorized && status.enabled;

  return (
    <section className="mt-4 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            Gmail auto-ingest
          </h2>
          <p className="mt-0.5 text-xs text-ink-500">
            {ready ? (
              <>
                Polling{' '}
                <span className="font-medium text-ink-700">
                  {status.mailbox ?? 'sales@'}
                </span>{' '}
                every 15 min for the daily RARCOA email. New sheets ingest
                automatically.
              </>
            ) : (
              <>
                Not yet active. Configure it on{' '}
                <a
                  href="/admin/integrations"
                  className="underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
                >
                  Integrations
                </a>{' '}
                to skip the manual upload.
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GmailStatusBadge status={status} />
          {ready && (
            <button
              onClick={onPoll}
              disabled={polling}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
            >
              {polling ? 'Checking…' : 'Check now'}
            </button>
          )}
        </div>
      </div>

      {/* Most recent poll outcome — folded into the card so the admin
          doesn't have to hunt for "did it actually work?" */}
      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      {result && !error && (
        <div className="mt-3 rounded-md bg-ink-50/60 p-3 text-xs">
          {result.skipped_reason ? (
            <p className="text-ink-500">
              Poll skipped — {result.skipped_reason}.
            </p>
          ) : result.matched === 0 ? (
            <p className="text-ink-500">
              No unprocessed RARCOA emails in the last 2 days.
            </p>
          ) : (
            <>
              <p className="text-ink-700">
                Matched {result.matched} · ingested{' '}
                <span className="font-semibold text-ink-900">
                  {result.ingested}
                </span>
              </p>
              <ul className="mt-2 space-y-1">
                {result.details.map((d) => (
                  <li
                    key={d.message_id}
                    className="flex items-start gap-2 border-t border-ink-100 pt-1 text-[11px]"
                  >
                    <OutcomeBadge outcome={d.outcome} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink-800">
                        {d.subject ?? '(no subject)'}
                      </div>
                      <div className="truncate text-ink-400">
                        {d.from ?? '—'}
                        {d.as_of_date ? ` · sheet ${formatDate(d.as_of_date)}` : ''}
                      </div>
                      {d.error && (
                        <div className="mt-0.5 font-mono text-[10px] text-red-700">
                          {d.error}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function GmailStatusBadge({ status }: { status: GmailStatus }) {
  let tone: 'ok' | 'warn' | 'muted' = 'muted';
  let label = 'not configured';
  if (!status.configured) {
    tone = 'muted';
    label = 'not configured';
  } else if (!status.authorized) {
    tone = 'warn';
    label = 'not authorized';
  } else if (!status.enabled) {
    tone = 'warn';
    label = 'disabled';
  } else if (status.last_test_ok === false) {
    tone = 'warn';
    label = 'test failed';
  } else {
    tone = 'ok';
    label = 'active';
  }
  const cls =
    tone === 'ok'
      ? 'bg-green-100 text-green-700'
      : tone === 'warn'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-ink-100 text-ink-500';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: PollResult['details'][number]['outcome'] }) {
  const { label, cls } = (() => {
    switch (outcome) {
      case 'ingested':
        return { label: 'ingested', cls: 'bg-green-100 text-green-700' };
      case 'skipped-no-pdf':
        return { label: 'no pdf', cls: 'bg-ink-100 text-ink-500' };
      case 'skipped-parse-fail':
        return { label: 'parse failed', cls: 'bg-amber-100 text-amber-700' };
      case 'error':
        return { label: 'error', cls: 'bg-red-100 text-red-700' };
    }
  })();
  return (
    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label}
    </span>
  );
}
