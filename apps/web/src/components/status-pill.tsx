/**
 * Invoice + shipment status pills. Two tiny named exports colocated here
 * because they're reused across ≥ 3 pages and Next.js 15's typed-routes
 * build rejects non-`default` exports from page files.
 */

export function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-ink-100 text-ink-600',
    finalized: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    shipped: 'bg-violet-100 text-violet-700',
    canceled: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        styles[status] ?? 'bg-ink-100 text-ink-600'
      }`}
    >
      {status}
    </span>
  );
}

export function ShipmentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    label_created: 'bg-ink-100 text-ink-600',
    in_transit: 'bg-blue-100 text-blue-700',
    out_for_delivery: 'bg-violet-100 text-violet-700',
    delivered: 'bg-green-100 text-green-700',
    exception: 'bg-amber-100 text-amber-700',
    returned: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        styles[status] ?? 'bg-ink-100 text-ink-600'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
