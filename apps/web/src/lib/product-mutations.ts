'use client';

import type { QueryClient } from '@tanstack/react-query';
import { apiFetch } from './api-client';

/**
 * Shared PATCH helper used by every inline edit / drop target on any
 * product-listing page (Catalog, Products, In-stock sheet, Buy sheet).
 * One place to own the cache-invalidation fan-out so an edit on one
 * surface refreshes every other surface that renders the same row.
 *
 * The backend accepts arbitrary UpdateProductDto fields; we pass them
 * through verbatim. Caller is responsible for validating / formatting
 * (e.g. InlineField's validate + format props).
 */
export async function savePatch(
  productId: string,
  qc: QueryClient,
  patch: Record<string, unknown>,
): Promise<void> {
  await apiFetch(`/admin/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'products', 'sheet'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'inventory'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'product', productId] }),
    qc.invalidateQueries({ queryKey: ['client', 'prices'] }),
    qc.invalidateQueries({ queryKey: ['client', 'in-stock'] }),
  ]);
}

/**
 * Reorder the full catalog. The server stores one global sort_order
 * per product (migration 018) — any drag on any surface ultimately
 * funnels into this endpoint so Catalog / In-stock sheet / Buy sheet
 * agree on the sequence. Caller passes the new flat list of product
 * ids in the desired order.
 *
 * Optimistic update: we rewrite sort_order values in the React Query
 * cache for ['admin', 'products'] and ['admin', 'products', 'sheet']
 * BEFORE awaiting the server. Without this, the sheet pages snap the
 * dragged row back to its old position during the ~200-500ms server
 * roundtrip because their render is driven entirely by cached
 * sort_order. If the server call fails we reset the cache.
 */
export async function saveOrder(
  qc: QueryClient,
  orderedIds: string[],
): Promise<void> {
  const positionByProduct = new Map<string, number>();
  orderedIds.forEach((id, i) => positionByProduct.set(id, (i + 1) * 10));

  // Snapshot for rollback.
  const prevProducts = qc.getQueryData(['admin', 'products']);
  const prevSheet = qc.getQueryData(['admin', 'products', 'sheet']);

  const applyOrder = <T extends { id?: string; product_id?: string; sort_order: number }>(
    rows: T[] | undefined,
  ): T[] | undefined => {
    if (!rows) return rows;
    return rows.map((r) => {
      const key = r.id ?? r.product_id;
      const next = key ? positionByProduct.get(key) : undefined;
      return next !== undefined ? { ...r, sort_order: next } : r;
    });
  };
  qc.setQueryData(['admin', 'products'], (rows: unknown) =>
    applyOrder(rows as Array<{ id?: string; product_id?: string; sort_order: number }>),
  );
  qc.setQueryData(['admin', 'products', 'sheet'], (rows: unknown) =>
    applyOrder(rows as Array<{ id?: string; product_id?: string; sort_order: number }>),
  );

  try {
    await apiFetch('/admin/products/reorder', {
      method: 'POST',
      body: JSON.stringify({ order: orderedIds }),
    });
  } catch (err) {
    // Roll back the optimistic cache so the UI reverts to the pre-drag
    // state instead of the in-flight intermediate.
    qc.setQueryData(['admin', 'products'], prevProducts);
    qc.setQueryData(['admin', 'products', 'sheet'], prevSheet);
    throw err;
  }

  await Promise.all([
    qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'products', 'sheet'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'inventory'] }),
    qc.invalidateQueries({ queryKey: ['client', 'prices'] }),
    qc.invalidateQueries({ queryKey: ['client', 'in-stock'] }),
  ]);
}
