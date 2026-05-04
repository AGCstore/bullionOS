'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { APP_SETTINGS_QUERY_KEY } from '@/lib/use-app-settings';

/**
 * Settings → Features
 *
 * Operator-facing toggle UI for the boolean feature flags + typed
 * scalar values declared in the BE settings-registry.ts. The page
 * fetches metadata (descriptions, defaults, types) from
 * GET /admin/settings/registry and the current values from
 * GET /admin/settings. Mutations PATCH the per-key endpoints; on
 * success the app-settings query is invalidated so every consumer
 * (sidebar nav, dashboard tile, scrap photos, etc.) re-evaluates
 * immediately.
 */

interface FlagDef {
  name: string;
  default: boolean;
  description: string;
}

interface ValueDef {
  name: string;
  type: 'string' | 'number';
  default: string | number;
  description: string;
}

interface RegistryResponse {
  flags: FlagDef[];
  values: ValueDef[];
}

interface AppSettingsResponse {
  flags: Record<string, boolean>;
  values: Record<string, string | number>;
}

export default function FeaturesSettingsPage() {
  const qc = useQueryClient();

  const { data: registry } = useQuery<RegistryResponse>({
    queryKey: ['admin', 'settings', 'registry'],
    queryFn: () => apiFetch<RegistryResponse>('/admin/settings/registry'),
    // Registry is built from a static TS object — never changes during
    // a session. Cache aggressively.
    staleTime: Infinity,
  });

  const { data: current } = useQuery<AppSettingsResponse>({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => apiFetch<AppSettingsResponse>('/admin/settings'),
  });

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setFlag(name: string, value: boolean) {
    setError(null);
    setSavingKey(`flag:${name}`);
    try {
      await apiFetch(`/admin/settings/flags/${name}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      });
      qc.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingKey(null);
    }
  }

  async function setValue(name: string, value: string | number) {
    setError(null);
    setSavingKey(`value:${name}`);
    try {
      await apiFetch(`/admin/settings/values/${name}`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      });
      qc.invalidateQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-4 text-xs text-ink-400">
        <Link href="/admin/settings" className="hover:underline">
          Settings
        </Link>
        <span className="mx-1">·</span>
        <span>Features</span>
      </nav>

      <h1 className="text-2xl font-semibold">Features</h1>
      <p className="mt-1 text-sm text-ink-400">
        Toggle optional capabilities and tune behavior. Changes apply
        immediately across the admin UI; new tabs and existing sessions
        refresh on next navigation.
      </p>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ─── Feature toggles ─────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Feature toggles
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-ink-200 bg-white">
          <ul className="divide-y divide-ink-100">
            {registry?.flags.map((flag) => {
              const enabled = current?.flags[flag.name] ?? flag.default;
              const saving = savingKey === `flag:${flag.name}`;
              return (
                <li key={flag.name} className="flex items-start gap-4 p-4">
                  <div className="flex-1">
                    <div className="font-mono text-sm font-medium text-ink-900">
                      {flag.name}
                    </div>
                    <div className="mt-1 text-sm text-ink-600">
                      {flag.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setFlag(flag.name, !enabled)}
                    className={`mt-1 inline-flex h-6 w-11 items-center rounded-full transition ${
                      enabled ? 'bg-emerald-600' : 'bg-ink-300'
                    } ${saving ? 'opacity-50' : ''}`}
                    aria-pressed={enabled}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                        enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ─── Typed values ────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Configuration values
        </h2>
        <div className="mt-3 space-y-3">
          {registry?.values.map((value) => (
            <ValueRow
              key={value.name}
              def={value}
              currentValue={current?.values[value.name] ?? value.default}
              saving={savingKey === `value:${value.name}`}
              onSave={(v) => setValue(value.name, v)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ValueRow({
  def,
  currentValue,
  saving,
  onSave,
}: {
  def: ValueDef;
  currentValue: string | number;
  saving: boolean;
  onSave: (v: string | number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string>(String(currentValue ?? ''));
  const [touched, setTouched] = useState(false);

  const isNumber = def.type === 'number';
  const dirty = touched && draft !== String(currentValue ?? '');

  async function commit() {
    if (!dirty) return;
    if (isNumber) {
      const n = Number(draft);
      if (!Number.isFinite(n)) return;
      await onSave(n);
    } else {
      await onSave(draft);
    }
    setTouched(false);
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="font-mono text-sm font-medium text-ink-900">
        {def.name}
      </div>
      <div className="mt-1 text-sm text-ink-600">{def.description}</div>
      <div className="mt-3 flex items-center gap-2">
        <input
          type={isNumber ? 'number' : 'text'}
          className="input flex-1"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setTouched(true);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
          }}
          disabled={saving}
        />
        {dirty && !saving && (
          <span className="text-[11px] text-amber-600">Unsaved</span>
        )}
        {saving && (
          <span className="text-[11px] text-ink-400">Saving…</span>
        )}
      </div>
    </div>
  );
}
