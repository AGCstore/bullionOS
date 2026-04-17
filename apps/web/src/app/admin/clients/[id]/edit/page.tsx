'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { ClientForm, fromClient, toDto } from '@/components/client-form';

export default function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin', 'client', id],
    queryFn: () => apiFetch<Record<string, string | null>>(`/admin/clients/${id}`),
  });

  if (!data) return <div className="text-sm text-ink-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Edit client</h1>

      <div className="mt-6">
        <ClientForm
          initial={fromClient(data as never)}
          submitLabel="Save"
          onCancel={() => router.push(`/admin/clients/${id}`)}
          onSubmit={async (v) => {
            await apiFetch(`/admin/clients/${id}`, {
              method: 'PATCH',
              body: JSON.stringify(toDto(v)),
            });
            await qc.invalidateQueries({ queryKey: ['admin', 'client', id] });
            await qc.invalidateQueries({ queryKey: ['admin', 'clients'] });
            router.push(`/admin/clients/${id}`);
          }}
        />
      </div>
    </div>
  );
}
