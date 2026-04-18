/**
 * Shared fuzzy search / scorer for product-like rows.
 *
 * Any row with {sku, name, metal} fields can be fed through
 * rankProducts(). Same weights as the invoice wizard's combobox so the
 * behavior is consistent everywhere operators search:
 *
 *   +100  SKU substring
 *   +15   SKU prefix
 *   +60   Name word-boundary match
 *   +30   Name substring
 *   +5    Metal substring
 *   +20   per matched query token
 *
 * Every query token must hit at least one of sku/name/metal — otherwise
 * the row is dropped. An empty query returns the input unchanged.
 */

export interface SearchableProduct {
  sku: string;
  name: string;
  metal: string;
}

export function rankProducts<T extends SearchableProduct>(
  rows: T[],
  rawQuery: string,
): T[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return rows;
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ r: T; s: number }> = [];
  for (const r of rows) {
    const sku = r.sku.toLowerCase();
    const name = r.name.toLowerCase();
    const metal = r.metal.toLowerCase();
    let ok = true;
    for (const t of tokens) {
      if (!sku.includes(t) && !name.includes(t) && !metal.includes(t)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let score = 0;
    if (sku.includes(q)) score += 100;
    if (sku.startsWith(q)) score += 15;
    if (name.includes(q)) score += 30;
    if (new RegExp(`\\b${escapeRegex(q)}`).test(name)) score += 60;
    if (metal.includes(q)) score += 5;
    score += tokens.length * 20;
    scored.push({ r, s: score });
  }
  scored.sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name));
  return scored.map((x) => x.r);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
