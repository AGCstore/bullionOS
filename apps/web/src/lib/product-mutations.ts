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
 * funnels into this endpoint so Catalog / Products / In-stock / Buy
 * sheet agree on the sequence. Caller passes the new flat list of
 * product ids in the desired order.
 */
export async function saveOrder(
  qc: QueryClient,
  orderedIds: string[],
): Promise<void> {
  await apiFetch('/admin/products/reorder', {
    method: 'POST',
    body: JSON.stringify({ order: orderedIds }),
  });
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'products', 'sheet'] }),
    qc.invalidateQueries({ queryKey: ['admin', 'inventory'] }),
    qc.invalidateQueries({ queryKey: ['client', 'prices'] }),
    qc.invalidateQueries({ queryKey: ['client', 'in-stock'] }),
  ]);
}
