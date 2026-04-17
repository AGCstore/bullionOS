'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: countData } = useQuery({
    queryKey: ['me', 'notifications', 'count'],
    queryFn: () => apiFetch<{ count: number }>('/me/notifications/unread-count'),
    refetchInterval: 20_000,
  });
  const { data: list } = useQuery({
    queryKey: ['me', 'notifications', 'list'],
    queryFn: () => apiFetch<Notification[]>('/me/notifications?unread=false'),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-notif-root]')) setOpen(false);
    };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);

  async function markAll() {
    await apiFetch('/me/notifications/read-all', { method: 'PATCH' });
    qc.invalidateQueries({ queryKey: ['me', 'notifications'] });
  }
  async function markOne(id: string) {
    await apiFetch(`/me/notifications/${id}/read`, { method: 'PATCH' });
    qc.invalidateQueries({ queryKey: ['me', 'notifications'] });
  }

  const count = countData?.count ?? 0;

  return (
    <div data-notif-root className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative rounded-md p-1.5 hover:bg-ink-50"
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-ink-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              Notifications
            </span>
            {count > 0 && (
              <button
                onClick={markAll}
                className="text-xs text-ink-600 hover:text-ink-900"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 divide-y divide-ink-200 overflow-y-auto">
            {(list ?? []).length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-ink-400">
                No notifications yet.
              </div>
            )}
            {(list ?? []).map((n) => {
              const unread = !n.read_at;
              const Inner = (
                <div className={`px-4 py-3 ${unread ? 'bg-ink-50' : ''}`}>
                  <div className="flex items-start justify-between">
                    <span className="text-sm font-medium">{n.title}</span>
                    {unread && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
                  </div>
                  {n.body && <p className="mt-1 text-xs text-ink-600">{n.body}</p>}
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-400">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              );
              return n.link ? (
                <a
                  key={n.id}
                  href={n.link}
                  onClick={() => unread && markOne(n.id)}
                  className="block hover:bg-ink-50/70"
                >
                  {Inner}
                </a>
              ) : (
                <button
                  key={n.id}
                  onClick={() => unread && markOne(n.id)}
                  className="block w-full text-left hover:bg-ink-50/70"
                >
                  {Inner}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-ink-600" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-12 0v3.2a2 2 0 01-.6 1.4L4 17h5" />
      <path d="M9 17a3 3 0 006 0" />
    </svg>
  );
}
