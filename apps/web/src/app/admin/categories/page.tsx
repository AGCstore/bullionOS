'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { apiFetch, ApiError } from '@/lib/api-client';
import {
  SECTIONS,
  METAL_GROUPS,
  type DisplaySection,
  type MetalGroup,
} from '@/lib/product-category';

interface CustomCategory {
  id: string;
  label: string;
  metal: MetalGroup;
}

interface ConfigPayload {
  custom: CustomCategory[];
  order: string[];
}

/**
 * Row shape used by the admin list. We intentionally broaden `id` to a
 * plain string (custom slugs aren't members of the DisplayCategory
 * union) and keep the rest of DisplaySection's fields intact.
 */
type Row = Omit<DisplaySection, 'id'> & { id: string; custom?: boolean };

/**
 * Admin-facing UI for the 12 builtin display categories + any
 * admin-added customs:
 *
 *   1. Drag to reorder. Persists to app_settings as an array of slugs.
 *      Every product-listing page reads this list via
 *      useDisplayCategories() so the new sequence ripples across
 *      Products / In-stock / What-we-pay / Catalog.
 *
 *   2. "Add custom category" form — slug + label + metal group.
 *      Products don't auto-route into customs; operators pin them
 *      individually via the product detail page's "Display category"
 *      dropdown.
 *
 *   3. Delete a custom category. Its row disappears + any product
 *      pinned to it falls back to the heuristic. (Builtins are
 *      locked — no delete affordance.)
 */
export default function CategoriesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'display-categories'],
    queryFn: () => apiFetch<ConfigPayload>('/admin/display-categories'),
  });

  // Merge builtins + customs into a single ordered list, applying the
  // server-side order preference. Mirrors useDisplayCategories so the
  // admin sees exactly what the rest of the app will render after save.
  const merged: Row[] = useMemo(() => {
    const all: Row[] = [
      ...SECTIONS.map<Row>((s) => ({ id: s.id, label: s.label, metal: s.metal })),
      ...(data?.custom ?? []).map<Row>((c) => ({
        id: c.id,
        label: c.label,
        metal: c.metal,
        custom: true,
      })),
    ];
    const order = data?.order ?? [];
    if (order.length === 0) return all;
    const idxMap = new Map(all.map((s, i) => [s.id, i]));
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const slug of order) {
      const idx = idxMap.get(slug);
      if (idx !== undefined && !seen.has(slug)) {
        out.push(all[idx]);
        seen.add(slug);
      }
    }
    for (const s of all) if (!seen.has(s.id)) out.push(s);
    return out;
  }, [data]);

  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    setItems(merged);
  }, [merged]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((s) => s.id === active.id);
    const newIdx = items.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(items, oldIdx, newIdx);
    const prev = items;
    setItems(next);
    try {
      await apiFetch('/admin/display-categories/order', {
        method: 'PUT',
        body: JSON.stringify({ order: next.map((s) => s.id) }),
      });
      qc.invalidateQueries({ queryKey: ['display-categories'] });
    } catch (err) {
      setItems(prev);
      alert(err instanceof ApiError ? `Reorder failed: ${err.message}` : 'Reorder failed');
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Display categories</h1>
        <p className="mt-1 text-sm text-ink-400">
          How products are grouped on the Products page, In-stock sheet, What
          we pay, and Catalog. Drag to reorder — changes apply everywhere.
        </p>
      </header>

      <AddForm
        onAdded={() => qc.invalidateQueries({ queryKey: ['admin', 'display-categories'] })}
      />

      <section className="mt-6 overflow-hidden rounded-xl border border-ink-200 bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-ink-400">Loading…</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={items.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {items.map((s) => (
                  <SortableRow
                    key={s.id}
                    row={s}
                    onDeleted={() =>
                      qc.invalidateQueries({
                        queryKey: ['admin', 'display-categories'],
                      })
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <p className="mt-4 text-xs text-ink-400">
        Builtins are locked — they track the default taxonomy and can&rsquo;t be
        deleted. Add your own categories for custom buckets (e.g. &ldquo;Estate
        lots&rdquo;, &ldquo;Holiday specials&rdquo;) and pin individual products to them on
        each product&rsquo;s detail page.
      </p>
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: () => void }) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [metal, setMetal] = useState<MetalGroup>('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/admin/display-categories/custom', {
        method: 'PUT',
        body: JSON.stringify({ id: id.trim(), label: label.trim(), metal }),
      });
      setId('');
      setLabel('');
      setMetal('other');
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 space-y-3 rounded-xl border border-ink-200 bg-white p-5"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
        Add a custom category
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs text-ink-600">
            Slug <span className="text-red-600">*</span>
          </span>
          <input
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase())}
            placeholder="estate_lots"
            pattern="[a-z][a-z0-9_]*"
            required
            maxLength={40}
            className="input mt-1 font-mono"
          />
          <span className="mt-1 block text-[10px] text-ink-400">
            lowercase, underscores only, start with a letter
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-ink-600">
            Label <span className="text-red-600">*</span>
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Estate Lots"
            required
            maxLength={80}
            className="input mt-1"
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-600">Metal group</span>
          <select
            value={metal}
            onChange={(e) => setMetal(e.target.value as MetalGroup)}
            className="input mt-1"
          >
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
            <option value="platinum">Platinum</option>
            <option value="palladium">Palladium</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add category'}
        </button>
      </div>
    </form>
  );
}

function SortableRow({ row, onDeleted }: { row: Row; onDeleted: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? '#f7f7f8' : undefined,
  };

  async function remove() {
    if (!confirm(`Delete custom category "${row.label}"? Any products pinned to it will fall back to the automatic routing.`)) return;
    try {
      await apiFetch(`/admin/display-categories/custom/${row.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 last:border-b-0 hover:bg-ink-50/50"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab px-1 text-ink-400 hover:text-ink-900 active:cursor-grabbing"
      >
        ⋮⋮
      </button>
      <span
        className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${METAL_GROUPS[row.metal].accentClass}`}
      >
        {METAL_GROUPS[row.metal].label}
      </span>
      <div className="flex-1">
        <div className="font-medium text-ink-900">{row.label}</div>
        <div className="font-mono text-xs text-ink-400">{row.id}</div>
      </div>
      {row.custom ? (
        <button
          onClick={remove}
          className="text-xs text-red-600 hover:text-red-800"
        >
          Delete
        </button>
      ) : (
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-500">
          builtin
        </span>
      )}
    </li>
  );
}
