'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';

interface PricingRule {
  id: string;
  scope: 'metal' | 'product';
  metal: string | null;
  product_id: string | null;
  buy_premium_type: 'percent' | 'flat';
  buy_premium_value: string;
  sell_premium_type: 'percent' | 'flat';
  sell_premium_value: string;
  is_active: boolean;
  effective_from: string;
}

const METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;

export default function PricingPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin', 'pricing-rules'],
    queryFn: () => apiFetch<PricingRule[]>('/admin/pricing-rules'),
  });

  const activeByMetal = useMemo(() => {
    const map: Record<string, PricingRule | undefined> = {};
    for (const r of data ?? []) {
      if (r.scope === 'metal' && r.is_active && r.metal) map[r.metal] = r;
    }
    return map;
  }, [data]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Pricing rules</h1>
      <p className="mt-1 text-sm text-ink-400">
        Metal defaults. Per-product overrides can be set from the product's edit view.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {METALS.map((m) => (
          <MetalRuleCard
            key={m}
            metal={m}
            rule={activeByMetal[m]}
            onSaved={() => qc.invalidateQueries({ queryKey: ['admin', 'pricing-rules'] })}
          />
        ))}
      </div>
    </div>
  );
}

function MetalRuleCard({
  metal,
  rule,
  onSaved,
}: {
  metal: string;
  rule?: PricingRule;
  onSaved: () => void;
}) {
  const [buyType, setBuyType] = useState<'percent' | 'flat'>(rule?.buy_premium_type ?? 'percent');
  const [buyValue, setBuyValue] = useState(rule?.buy_premium_value ?? '-3');
  const [sellType, setSellType] = useState<'percent' | 'flat'>(rule?.sell_premium_type ?? 'percent');
  const [sellValue, setSellValue] = useState(rule?.sell_premium_value ?? '4');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/admin/pricing-rules', {
        method: 'POST',
        body: JSON.stringify({
          scope: 'metal',
          metal,
          buy_premium_type: buyType,
          buy_premium_value: Number(buyValue),
          sell_premium_type: sellType,
          sell_premium_value: Number(sellValue),
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold capitalize">{metal}</h3>
        {rule ? (
          <span className="text-[10px] uppercase tracking-wide text-ink-400">
            since {new Date(rule.effective_from).toISOString().slice(0, 10)}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-red-600">no rule</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-400">Buy</div>
          <div className="mt-1 flex gap-2">
            <select
              value={buyType}
              onChange={(e) => setBuyType(e.target.value as 'percent' | 'flat')}
              className="input w-24"
            >
              <option value="percent">%</option>
              <option value="flat">$/oz</option>
            </select>
            <input
              type="number"
              step="0.0001"
              value={buyValue}
              onChange={(e) => setBuyValue(e.target.value)}
              className="input flex-1 font-mono"
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-400">Negative = discount below spot</p>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-400">Sell</div>
          <div className="mt-1 flex gap-2">
            <select
              value={sellType}
              onChange={(e) => setSellType(e.target.value as 'percent' | 'flat')}
              className="input w-24"
            >
              <option value="percent">%</option>
              <option value="flat">$/oz</option>
            </select>
            <input
              type="number"
              step="0.0001"
              value={sellValue}
              onChange={(e) => setSellValue(e.target.value)}
              className="input flex-1 font-mono"
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-400">Positive = premium above spot</p>
        </div>
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
    </div>
  );
}
