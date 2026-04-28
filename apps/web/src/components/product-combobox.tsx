'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface ComboboxProduct {
  id: string;
  sku: string;
  name: string;
  metal: string;
}

/**
 * Fuzzy product picker for the invoice wizard.
 *
 * Replaces the bare <select> that held 600+ rows. Typing filters the list
 * by scoring SKU/name/metal against the query with a lightweight ranker:
 *   +100 substring match in SKU
 *   +60  word-boundary match in name
 *   +30  substring match in name
 *   +20  per additional token that matches anywhere
 *   +15  bonus for prefix match
 * Empty query falls back to alphabetical by name (same as stock order).
 *
 * A caller-supplied "+ New item" sentinel option can be injected at the
 * top — click it and the combobox closes with an empty value. The wizard
 * listens for an empty value with a non-empty custom-name elsewhere.
 */
export function ProductCombobox({
  products,
  value,
  adHoc,
  onChange,
  onPickAdHoc,
  placeholder = 'Search products…',
}: {
  products: ComboboxProduct[];
  /** Selected product id, or '' when nothing picked / ad-hoc mode. */
  value: string;
  /** True when the row is in "New item" mode (show sentinel styling). */
  adHoc: boolean;
  onChange: (productId: string) => void;
  onPickAdHoc: () => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selected = useMemo(
    () => products.find((p) => p.id === value) ?? null,
    [products, value],
  );

  const ranked = useMemo(() => rank(products, query), [products, query]);

  // Keep activeIdx inside the visible list as it shrinks.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      // +1 accounts for the "+ New item" row at index 0.
      setActiveIdx((i) => Math.min(i + 1, ranked.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitAt(activeIdx);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function commitAt(idx: number) {
    if (idx === 0) {
      onPickAdHoc();
      setOpen(false);
      setQuery('');
      return;
    }
    const product = ranked[idx - 1];
    if (!product) return;
    onChange(product.id);
    setOpen(false);
    setQuery('');
  }

  const displayLabel = adHoc
    ? 'New item'
    : selected
      ? selected.name
      : '';

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : displayLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        className="input w-full"
        role="combobox"
        aria-expanded={open}
        aria-controls="product-combobox-list"
        aria-autocomplete="list"
      />
      {open && (
        <ul
          id="product-combobox-list"
          // z-40 beats any sibling section (which defaults to auto/0).
          // Previously z-20 was enough but with the invoice wizard's
          // multiple bg-white cards we want margin for error — later-DOM
          // sections that happen to form a stacking context (transforms
          // on hover, etc.) would otherwise paint over the dropdown.
          className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-md border border-ink-200 bg-white shadow-lg"
          role="listbox"
        >
          <li
            role="option"
            aria-selected={activeIdx === 0}
            onMouseDown={(e) => {
              e.preventDefault();
              commitAt(0);
            }}
            onMouseEnter={() => setActiveIdx(0)}
            className={`cursor-pointer border-b border-ink-100 px-3 py-2 text-sm ${
              activeIdx === 0 ? 'bg-ink-900 text-white' : 'text-ink-900'
            }`}
          >
            + New item
            <span
              className={`ml-2 text-[10px] ${
                activeIdx === 0 ? 'text-ink-200' : 'text-ink-400'
              }`}
            >
              scrap / one-off / custom
            </span>
          </li>
          {ranked.map((p, i) => {
            const rowIdx = i + 1;
            const isActive = activeIdx === rowIdx;
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitAt(rowIdx);
                }}
                onMouseEnter={() => setActiveIdx(rowIdx)}
                className={`cursor-pointer border-b border-ink-100 px-3 py-2 text-sm last:border-b-0 ${
                  isActive ? 'bg-ink-900 text-white' : 'text-ink-900'
                }`}
              >
                <div className="font-medium">{p.name}</div>
                <div
                  className={`text-[11px] capitalize ${
                    isActive ? 'text-ink-200' : 'text-ink-400'
                  }`}
                >
                  {p.metal}
                </div>
              </li>
            );
          })}
          {ranked.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-ink-400">
              No matches. Use &ldquo;New item&rdquo; above to enter one manually.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Fuzzy scorer. Tokenizes the query on whitespace.
 *
 * Matching rule (Apr 2026 v3 — typo tolerance added):
 *   - Build a single "haystack" string of `name + metal + sku`.
 *   - Each token in the query must appear in that haystack, either
 *     as an exact substring OR as a near-match (Levenshtein edit
 *     distance ≤ 1 for 4–6 char tokens, ≤ 2 for 7+ char tokens)
 *     against one of the haystack's words.
 *   - Order-insensitive — "gold eagle", "eagle gold",
 *     "eagle 1oz gold" all match "American Gold Eagle 1 oz".
 *   - Typos tolerated — "eaggle", "krugerand", "amercan" still
 *     find their targets. Short tokens (< 4 chars) require an
 *     exact substring match to keep false positives bounded —
 *     "oz" shouldn't fuzzy-match "of", "at", etc.
 *   - Score favors exact phrase matches, word-boundary hits, and
 *     name prefixes. Fuzzy hits are accepted but penalized so a
 *     row that matches exactly still ranks above one that matches
 *     via typo tolerance.
 */
/**
 * Normalize weight expressions so "1oz" and "1 oz" tokenize identically.
 * Applied to BOTH the query and the haystack before any matching, so
 * the search is unit-spacing-agnostic across every size in the catalog.
 *
 * Insertions:
 *   1oz       → 1 oz       1 oz       → 1 oz       (idempotent)
 *   1/10oz    → 1/10 oz    1/10 oz    → 1/10 oz
 *   1/2oz     → 1/2 oz     1.5oz      → 1.5 oz
 *   100gram   → 100 gram   100grams   → 100 grams
 *   5kg       → 5 kg       50g        → 50 g
 *
 * Decimals + fractions both supported. The unit token must be a real
 * weight unit (oz / g / kg / gram / grams) at a word boundary so we
 * don't accidentally split tokens like "20g" inside an ID number.
 */
function normalizeWeights(s: string): string {
  return s.replace(
    /(\d+(?:[/.]\d+)?)\s*(oz|kg|grams?|g)\b/gi,
    '$1 $2',
  );
}

function rank(
  products: ComboboxProduct[],
  rawQuery: string,
): ComboboxProduct[] {
  const q = normalizeWeights(rawQuery.trim().toLowerCase());
  if (!q) {
    return [...products].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ p: ComboboxProduct; s: number }> = [];
  for (const p of products) {
    const sku = normalizeWeights(p.sku.toLowerCase());
    const name = normalizeWeights(p.name.toLowerCase());
    const metal = p.metal.toLowerCase();
    // Single haystack for the per-token presence check. Joined with
    // spaces so tokens can't accidentally bridge two fields
    // (e.g., "goldamerican" shouldn't match name="gold" + sku="american…").
    const hay = `${name} ${metal} ${sku}`;
    // Word list for fuzzy matching. Split on whitespace + common
    // punctuation so "1/10" tokenizes into "1" + "10" and an operator
    // typing "1/10 eagle" fuzzy-matches either.
    const hayWords = hay.split(/[\s\-/._,]+/).filter(Boolean);

    // Gate: every token must appear in the haystack, either exactly
    // or via typo-tolerant match. Track which tokens needed fuzzy so
    // we can penalize in scoring.
    let allPresent = true;
    let fuzzyCount = 0;
    for (const t of tokens) {
      if (hay.includes(t)) continue;
      // Fuzzy fallback — only for tokens long enough to make the
      // typo meaningful.
      if (t.length < 4) {
        allPresent = false;
        break;
      }
      if (!anyWordWithinDistance(t, hayWords)) {
        allPresent = false;
        break;
      }
      fuzzyCount++;
    }
    if (!allPresent) continue;

    // Scoring: we're past the gate, now just rank the survivors.
    let score = 0;

    // Full-phrase contiguous matches still get top billing — when
    // "american eagle" appears literally in the name, it should beat
    // a row where "american" and "eagle" are scattered apart.
    if (name.includes(q)) score += 120;
    if (sku.includes(q)) score += 80;

    // Word-boundary hit in name — "eagle" at a word start beats
    // "eagle" buried inside "spread-eagled".
    if (new RegExp(`\\b${escapeRegex(q)}`).test(name)) score += 60;

    // Prefix bonuses: typing "amer" should push American… to the top.
    if (name.startsWith(q)) score += 40;
    if (sku.startsWith(q)) score += 30;

    // Per-token credits — rewards rows that hit multiple tokens at
    // word boundaries in the name.
    for (const t of tokens) {
      if (name.includes(t)) score += 15;
      if (new RegExp(`\\b${escapeRegex(t)}`).test(name)) score += 10;
      if (sku.includes(t)) score += 6;
      if (metal === t) score += 4;
    }

    // Penalty per fuzzy-matched token. A row with one typo'd token
    // (score - 30) stays ahead of random low-score rows but sits
    // below clean matches. Scales so 2 typos ≈ the full-phrase bonus.
    score -= fuzzyCount * 30;

    scored.push({ p, s: score });
  }
  scored.sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));
  return scored.slice(0, 200).map((x) => x.p);
}

/**
 * Does any word in `words` sit within typo-distance of `token`?
 * Threshold: 1 edit for short tokens (4–6 chars), 2 edits for
 * longer tokens. Returns on first hit — the ranker doesn't care
 * which word matched, only that ONE did.
 */
function anyWordWithinDistance(token: string, words: string[]): boolean {
  const maxEdit = token.length >= 7 ? 2 : 1;
  for (const w of words) {
    // Length gate: if the lengths differ by more than maxEdit, no
    // edit distance can bridge them. Cheap short-circuit before the
    // full DP.
    if (Math.abs(w.length - token.length) > maxEdit) continue;
    if (levenshteinAtMost(token, w, maxEdit) <= maxEdit) return true;
  }
  return false;
}

/**
 * Bounded Levenshtein — returns the true distance when it's ≤ max,
 * or max+1 as a "too far" sentinel. Early-exits when every cell in
 * a row exceeds max, saving work on obviously-unrelated words.
 *
 * Standard DP across two rolling rows. Transpositions (Damerau)
 * aren't handled — they add code weight and only help for adjacent
 * swaps, which are rare typos in coin-product names.
 */
function levenshteinAtMost(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(
        curr[j - 1] + 1, // insert
        prev[j] + 1, // delete
        prev[j - 1] + cost, // substitute
      );
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
