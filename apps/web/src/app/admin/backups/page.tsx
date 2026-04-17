'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError, getAccessToken } from '@/lib/api-client';

interface BackupRow {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  trigger: 'cron' | 'manual';
  started_at: string;
  completed_at: string | null;
  size_bytes: string | null;
  error: string | null;
  created_by_user_id: string | null;
}

export default function BackupsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'backups'],
    queryFn: () => apiFetch<BackupRow[]>('/admin/backups'),
    // Poll while one is in progress so the UI transitions pending → done.
    refetchInterval: (q) => {
      const list = (q.state.data as BackupRow[] | undefined) ?? [];
      return list.some((r) => r.status === 'pending') ? 3_000 : 30_000;
    },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/admin/backups/run', { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['admin', 'backups'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string) {
    // Same bearer-in-fetch pattern as the invoice PDF button: keeps the
    // token out of the URL and lets us expose a nicely named file.
    const token = getAccessToken();
    const res = await fetch(`/api/v1/admin/backups/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      alert('Download failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = res.headers.get('content-disposition') ?? '';
    const m = /filename="([^"]+)"/.exec(disposition);
    a.download = m ? m[1] : `agc-backup-${id}.dump.gz`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Backups</h1>
          <p className="mt-1 text-sm text-ink-400">
            Daily pg_dump snapshots, automatically captured at 8:00 PM Eastern.
            Retained for 30 days. Download any backup below, or trigger one on
            demand.
          </p>
        </div>
        <button
          onClick={runNow}
          disabled={busy}
          className="rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? 'Starting…' : 'Run backup now'}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Size</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3 text-right">Download</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-ink-200 align-top">
                  <td className="px-4 py-3 font-mono text-xs">
                    {new Date(r.started_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-ink-600 capitalize">{r.trigger}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                    {r.error && (
                      <div className="mt-1 text-xs text-red-700">{r.error}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.size_bytes ? formatSize(Number(r.size_bytes)) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-400">
                    {r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'succeeded' ? (
                      <button
                        onClick={() => download(r.id)}
                        className="rounded-md border border-ink-200 px-3 py-1 text-xs hover:bg-ink-50"
                      >
                        Download
                      </button>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-400">
                    No backups yet. Click &ldquo;Run backup now&rdquo; to take the first snapshot.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      <p className="mt-4 text-xs text-ink-400">
        Restore instructions: download a <code>.dump.gz</code>, then run{' '}
        <code className="bg-ink-50 px-1">gunzip file.dump.gz</code> and{' '}
        <code className="bg-ink-50 px-1">pg_restore -d $URL file.dump</code>{' '}
        against a fresh database.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: BackupRow['status'] }) {
  const cls =
    status === 'succeeded'
      ? 'bg-green-100 text-green-700'
      : status === 'failed'
        ? 'bg-red-100 text-red-700'
        : 'bg-amber-100 text-amber-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
