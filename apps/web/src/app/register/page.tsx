'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerSchema } from '@agc/shared';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState({
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    phone: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({
      ...form,
      phone: form.phone || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setSubmitting(true);
    try {
      await register(parsed.data);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-ink-200">
        <h1 className="text-xl font-semibold text-ink-900">Create account</h1>
        <p className="mt-1 text-sm text-ink-400">Takes less than a minute</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" value={form.first_name} onChange={update('first_name')} required />
            <Field label="Last name" value={form.last_name} onChange={update('last_name')} required />
          </div>
          <Field label="Email" type="email" value={form.email} onChange={update('email')} required />
          <Field label="Phone (optional)" value={form.phone} onChange={update('phone')} />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={update('password')}
            hint="12+ chars, letters and numbers"
            required
          />

          {error && (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-800 disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-400">
          Already have an account?{' '}
          <Link href="/login" className="text-ink-900 underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      <input
        {...rest}
        className="mt-1 block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-ink-900 outline-none ring-gold-500/30 focus:ring-2"
      />
      {hint && <span className="mt-1 block text-xs text-ink-400">{hint}</span>}
    </label>
  );
}
