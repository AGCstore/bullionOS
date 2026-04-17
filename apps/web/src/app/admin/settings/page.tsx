'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError, getAccessToken } from '@/lib/api-client';

interface Branding {
  company_name: string;
  company_tagline: string;
  logo_path: string | null;
  logo_url: string | null;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => apiFetch<{ branding: Branding }>('/admin/settings'),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-ink-400">Branding that appears on invoices and PDFs.</p>

      <BrandingForm
        branding={data?.branding}
        onChanged={() => qc.invalidateQueries({ queryKey: ['admin', 'settings'] })}
      />

      <LogoCard
        branding={data?.branding}
        onChanged={() => qc.invalidateQueries({ queryKey: ['admin', 'settings'] })}
      />
    </div>
  );
}

function BrandingForm({
  branding,
  onChanged,
}: {
  branding?: Branding;
  onChanged: () => void;
}) {
  const [name, setName] = useState(branding?.company_name ?? '');
  const [tagline, setTagline] = useState(branding?.company_tagline ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync local state when fresh data lands.
  if (branding && name === '' && branding.company_name) {
    setName(branding.company_name);
    setTagline(branding.company_tagline);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/admin/settings/branding', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: name, company_tagline: tagline }),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Company</h2>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-ink-800">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input mt-1"
            maxLength={100}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink-800">Tagline</span>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="input mt-1"
            maxLength={200}
          />
        </label>
      </div>
      {error && (
        <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

function LogoCard({
  branding,
  onChanged,
}: {
  branding?: Branding;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cache-bust the logo preview after upload/delete so the new image shows.
  const [bust, setBust] = useState(0);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const token = getAccessToken();
      const res = await fetch('/api/v1/admin/settings/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? 'Upload failed');
      }
      setBust(Date.now());
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    setError(null);
    try {
      await apiFetch('/admin/settings/logo', { method: 'DELETE' });
      setBust(Date.now());
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    }
  }

  const hasLogo = Boolean(branding?.logo_path);

  return (
    <section className="mt-6 rounded-xl border border-ink-200 bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Invoice logo</h2>
      <p className="mt-1 text-xs text-ink-400">
        PNG or JPEG up to 1&nbsp;MB. Appears at the top of every invoice PDF.
      </p>

      <div className="mt-4 flex items-center gap-6">
        <div className="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-ink-200 bg-ink-50 p-3">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v1/public/branding/logo?v=${bust}`}
              alt="Logo preview"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-ink-400">No logo</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
            className="hidden"
            id="logo-input"
          />
          <label
            htmlFor="logo-input"
            className="inline-block cursor-pointer rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
          >
            {uploading ? 'Uploading…' : hasLogo ? 'Replace logo' : 'Upload logo'}
          </label>
          {hasLogo && (
            <button
              onClick={remove}
              className="rounded-md border border-ink-200 px-4 py-1.5 text-sm text-ink-700 hover:bg-red-50 hover:text-red-700"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}
