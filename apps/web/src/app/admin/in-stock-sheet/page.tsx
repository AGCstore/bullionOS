'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { PageTint } from '@/components/page-tint';
import { InlinePriceEditor, type PricingRule } from '@/components/inline-price-editor';
import { useLiveSpot } from '@/lib/use-live-spot';
import type { SheetRow } from '@/lib/sheet-types';
import {
  SECTIONS,
  METAL_GROUPS,
  deriveDisplayCategory,
  groupSectionsByMetal,
  type DisplayCategory,
} from '@/lib/product-category';
import { rankProducts } from '@/lib/product-search';
import { InlineField } from '@/components/inline-field';
import { savePatch, saveOrder } from '@/lib/product-mutations';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface EnrichedSheet extends SheetRow {
  displayCategory: DisplayCategory;
}

export default function InStockSheetPage() {
  const qc = useQueryClient();
  const { spot } = useLiveSpot();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products', 'sheet'],
    queryFn: () => apiFetch<SheetRow[]>('/admin/products/sheet'),
    refetchInterval: 60_000,
  });

  // Drop non-stocked rows before the ranker runs so the match count
  // reflects what the operator actually sees.
  const inStockRows = useMemo(
    () => (data ?? []).filter((r) => r.available > 0),
    [data],
  );
  const filtered = useMemo(
    () => rankProducts(inStockRows, search),
    [inStockRows, search],
  );

  const bySection = useMemo(() => {
    const out = new Map<DisplayCategory, EnrichedSheet[]>();
    for (const s of SECTIONS) out.set(s.id, []);
    for (const row of filtered) {
      const enriched: EnrichedSheet = {
        ...row,
        displayCategory: deriveDisplayCategory(row),
      };
      out.get(enriched.displayCategory)?.push(enriched);
    }
    // Sort by operator's manual sort_order (shared across every surface).
    // Tie-break on name only if two products end up with identical ranks.
    for (const list of out.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }
    return out;
  }, [filtered]);

  const sectionsToRender = SECTIONS.filter((s) => (bySection.get(s.id)?.length ?? 0) > 0);

  // Drag reorder — in-section only. Drop outside the section is a no-op
  // (cross-section move is a planned follow-up via display_category_override).
  // The drop persists via saveOrder, which POSTs /admin/products/reorder so
  // Catalog / Products / Buy sheet / client surfaces all update on their
  // next fetch. Disabled while a search is active (filtered indices would
  // reorder against sparse positions in the full catalog).
  const dragDisabled = search.trim().length > 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    for (const section of SECTIONS) {
      const rows = bySection.get(section.id);
      if (!rows) continue;
      const oldIdx = rows.findIndex((r) => r.product_id === active.id);
      const newIdx = rows.findIndex((r) => r.product_id === over.id);
      if (oldIdx < 0 || newIdx < 0) continue;
      // Both ids in this section — reorder and persist.
      const reordered = arrayMove(rows, oldIdx, newIdx);
      // Rebuild the full flat id list by concatenating every section in
      // declared order, with this section swapped in.
      const flat: string[] = [];
      for (const s of SECTIONS) {
        const r = s.id === section.id ? reordered : bySection.get(s.id);
        if (r) flat.push(...r.map((x) => x.product_id));
      }
      try {
        await saveOrder(qc, flat);
      } catch (err) {
        alert((err as Error).message ?? 'Reorder failed');
      }
      return;
    }
  }

  return (
    <PageTint side="sell">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">In-stock sheet</h1>
            <p className="mt-1 text-sm text-ink-400">
              Grouped by product family. Click any price column header to jump
              sections. Edit premiums inline — saves to the product&rsquo;s pricing
              rule.
            </p>
          </div>
          <div className="text-right text-xs text-ink-400">
            {spot?.asOf ? `Spot updated ${timeSince(spot.asOf)}` : '—'}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SKU, name, or metal…"
            className="input w-full md:w-96"
            aria-label="Search in-stock products"
          />
          {search.trim() && (
            <span className="text-xs text-ink-400">
              {filtered.length} match{filtered.length === 1 ? '' : 'es'}
              <button
                onClick={() => setSearch('')}
                className="ml-2 underline-offset-2 hover:underline"
              >
                clear
              </button>
            </span>
          )}
        </div>

        {sectionsToRender.length > 0 && (
          <nav className="sticky top-0 z-10 -mx-2 mt-6 overflow-x-auto rounded-xl border border-sell-200 bg-white/95 px-2 py-2 backdrop-blur">
            <div className="flex min-w-max items-center gap-4 text-xs">
              {groupSectionsByMetal(sectionsToRender).map((g) => (
                <div key={g.metal} className="flex items-center gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${METAL_GROUPS[g.metal].accentClass}`}
                  >
                    {METAL_GROUPS[g.metal].label}
                  </span>
                  {g.sections.map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-ink-700 hover:bg-sell-50"
                    >
                      {s.label}
                      <span className="rounded-full bg-sell-100 px-1.5 text-[10px] text-sell-700">
                        {bySection.get(s.id)!.length}
                      </span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </nav>
        )}

        {isLoading && (
          <div className="mt-8 rounded-xl border border-ink-200 bg-white p-8 text-center text-sm text-ink-400">
            Loading…
          </div>
        )}

        {!isLoading && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            {groupSectionsByMetal(sectionsToRender).map((g) => (
              <div key={g.metal}>
                <h2
                  className={`mt-10 mb-2 rounded-md border px-3 py-2 text-lg font-semibold ${METAL_GROUPS[g.metal].accentClass}`}
                >
                  {METAL_GROUPS[g.metal].label}
                </h2>
                {g.sections.map((s) => (
                  <SheetSection
                    key={s.id}
                    id={s.id}
                    label={s.label}
                    rows={bySection.get(s.id)!}
                    dragDisabled={dragDisabled}
                    onEdited={() =>
                      qc.invalidateQueries({ queryKey: ['admin', 'products', 'sheet'] })
                    }
                  />
                ))}
              </div>
            ))}
          </DndContext>
        )}

        {!isLoading && sectionsToRender.length === 0 && (
          <div className="mt-8 rounded-xl border border-ink-200 bg-white p-12 text-center text-sm text-ink-400">
            Nothing in stock right now.
          </div>
        )}
      </div>
    </PageTint>
  );
}

function SheetSection({
  id,
  label,
  rows,
  dragDisabled,
  onEdited,
}: {
  id: string;
  label: string;
  rows: EnrichedSheet[];
  dragDisabled: boolean;
  onEdited: () => void;
}) {
  return (
    <section id={id} className="mt-8 scroll-mt-24">
      <h2 className="mb-2 text-base font-semibold text-sell-700">{label}</h2>
      {/* MOB-002: horizontal scroll on narrow viewports. */}
      <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">We buy</th>
              <th className="px-4 py-3 text-right">We sell</th>
              <th className="px-4 py-3 text-right w-32">Edit</th>
            </tr>
          </thead>
          <SortableContext
            items={rows.map((r) => r.product_id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {rows.map((r) => (
                <SheetRowView
                  key={r.product_id}
                  row={r}
                  dragDisabled={dragDisabled}
                  onEdited={onEdited}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </div>
    </section>
  );
}

function SheetRowView({
  row,
  dragDisabled,
  onEdited,
}: {
  row: EnrichedSheet;
  dragDisabled: boolean;
  onEdited: () => void;
}) {
  const qc = useQueryClient();
  const { data: rule } = useQuery({
    queryKey: ['admin', 'product', row.product_id, 'rule'],
    queryFn: () =>
      apiFetch<PricingRule>(`/admin/products/${row.product_id}/pricing-rule`),
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.product_id, disabled: dragDisabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? '#f7f7f8' : undefined,
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-t border-ink-200 align-top">
      <td className="px-2 py-3 text-center">
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          disabled={dragDisabled}
          className={`px-1 ${
            dragDisabled
              ? 'cursor-not-allowed text-ink-200'
              : 'cursor-grab text-ink-400 hover:text-ink-900 active:cursor-grabbing'
          }`}
        >
          ⋮⋮
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">
          <InlineField
            value={row.name}
            onSave={async (next) => {
              await savePatch(row.product_id, qc, { name: next });
              onEdited();
            }}
            maxLength={200}
            ariaLabel="product name"
            validate={(v) => (v.trim().length === 0 ? 'Name required' : null)}
          />
        </div>
        <div className="font-mono text-xs text-ink-400">
          {row.sku}
          <span className="ml-2">
            · purity{' '}
            <InlineField
              value={String(row.purity)}
              onSave={async (next) => {
                await savePatch(row.product_id, qc, { purity: Number(next) });
                onEdited();
              }}
              type="number"
              step="0.0001"
              min={0.0001}
              max={1}
              ariaLabel="purity"
              format={(v) => Number(v).toFixed(4)}
              validate={(v) => {
                const n = Number(v);
                if (!Number.isFinite(n) || n <= 0 || n > 1)
                  return '0 < x ≤ 1';
                return null;
              }}
              inputClassName="w-20"
            />
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono font-semibold">{row.available}</td>
      <td className="px-4 py-3 text-right font-mono text-ink-900">
        {row.buy_price !== null ? `$${Number(row.buy_price).toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-3 text-right font-mono text-ink-900">
        {row.sell_price !== null ? `$${Number(row.sell_price).toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-3">
        {rule ? (
          <InlinePriceEditor
            productId={row.product_id}
            rule={rule}
            onChanged={onEdited}
          />
        ) : (
          <span className="text-xs text-ink-400">…</span>
        )}
      </td>
    </tr>
  );
}

function timeSince(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(iso).toLocaleTimeString();
}
