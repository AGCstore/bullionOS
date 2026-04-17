'use client';

import { useAuth } from '@/lib/auth-context';

export default function DashboardOverview() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Welcome back{user.first_name ? `, ${user.first_name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            Overview of your account and activity.
          </p>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Lifetime volume" value="—" hint="USD" />
        <Stat label="Open transactions" value="—" />
        <Stat label="Pending requests" value="—" />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-400">
          Recent activity
        </h2>
        <div className="mt-3 rounded-xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
          No activity yet. Your transactions will appear here.
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-ink-900">{value}</span>
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </div>
    </div>
  );
}
