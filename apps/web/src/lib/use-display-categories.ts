'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from './api-client';
import {
  SECTIONS,
  type DisplaySection,
  type MetalGroup,
} from './product-category';

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
 * Row shape returned to every product-listing page. Admin-added slugs
 * aren't members of the DisplayCategory union, so we widen `id` to a
 * plain string. `custom: true` lets callers render a different affordance
 * for user-added entries if they choose.
 */
type Row = Omit<DisplaySection, 'id'> & { id: string; custom?: boolean };

/**
 * Hook for every product-listing page. Returns the final ordered list
 * of display sections to render — builtin 12 merged with any admin-
 * added custom categories, reordered per the operator's preference.
 *
 * Falls back to the compiled-in SECTIONS if the API is unreachable, so
 * first paint is never blank and a logged-in admin can still work
 * offline (cached query).
 */
export function useDisplayCategories() {
  const { data } = useQuery({
    // Intentionally unauth'd — the same list serves public views + admin.
    queryKey: ['display-categories'],
    queryFn: () => apiFetch<ConfigPayload>('/public/display-categories'),
    staleTime: 60_000,
  });

  return useMemo(() => {
    const custom = data?.custom ?? [];
    const order = data?.order ?? [];

    // Merge: builtins first, then custom appended. Mark custom so the
    // admin UI can render a delete affordance (builtins aren't deletable).
    const all: Row[] = [
      ...SECTIONS.map<Row>((s) => ({ id: s.id, label: s.label, metal: s.metal })),
      ...custom.map<Row>((c) => ({
        id: c.id,
        label: c.label,
        metal: c.metal,
        custom: true,
      })),
    ];

    // Apply preferred order if non-empty. Ids present in `order` go first
    // in that sequence; everything else keeps its compiled-in position.
    if (order.length > 0) {
      const indexByMe = new Map<string, number>();
      all.forEach((s, i) => indexByMe.set(s.id, i));
      const seenInOrder = new Set<string>();
      const sorted: Row[] = [];
      for (const slug of order) {
        const idx = indexByMe.get(slug);
        if (idx !== undefined && !seenInOrder.has(slug)) {
          sorted.push(all[idx]);
          seenInOrder.add(slug);
        }
      }
      for (const s of all) {
        if (!seenInOrder.has(s.id)) sorted.push(s);
      }
      return {
        sections: sorted,
        knownSlugs: new Set(all.map((s) => s.id)),
        customSlugs: new Set(custom.map((c) => c.id)),
      };
    }

    return {
      sections: all,
      knownSlugs: new Set(all.map((s) => s.id)),
      customSlugs: new Set(custom.map((c) => c.id)),
    };
  }, [data]);
}
