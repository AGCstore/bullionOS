/**
 * AGC markdown multipliers applied to RARCOA bid prices to compute
 * the in-store "we pay" rate. Derived directly from the formulas in
 * the operator's Google Sheet (AGC.RARCOA REF SHEET → Sheet1) — every
 * cell in Sheet1 was `=SUM(Sheet3!XX * NN%)`, so the factors here are
 * a straight port.
 *
 * Any value not covered by the lookup falls back to a safe 85% — all
 * real RARCOA products are explicitly listed though; the fallback is
 * purely defensive in case RARCOA adds a new row we haven't seen.
 *
 * "Spots" factor applies to w/Spots variants in the certified grid —
 * the Sheet1 "MS61 w/Spots" column is `MS61 * spots_factor`. Stored
 * alongside the base factor so the admin UI can compute both in one
 * pass.
 */

export interface RarcoaMarkdown {
  /** Fraction applied to RARCOA bid for clean (no-spots) coins. */
  factor: number;
  /** Fraction applied on top of the clean factor for w/Spots coins. */
  spots_factor?: number;
}

export type MarkdownKey = {
  section:
    | 'uncertified_gold'
    | 'uncertified_large_gold'
    | 'certified_gold'
    | 'morgan_dollar'
    | 'peace_dollar';
  product: string;
  /**
   * When set, matches on product+grade. When absent, matches on
   * product for any grade within the section. Lets us express
   * "all VF/XF/AU/BU columns of $1 Type I discount by 82%" as a
   * single row rather than four.
   */
  grade?: string;
  /** Override with a "tone" dimension for silver clean vs toned. */
  tone?: 'clean' | 'toned';
};

type MarkdownRow = MarkdownKey & RarcoaMarkdown;

/**
 * Master table of markdowns. Order doesn't matter — lookup() picks
 * the most specific match (product+grade over product alone).
 */
const MARKDOWNS: MarkdownRow[] = [
  // Uncertified gold (Sheet1 rows 14-16, 19): straight 82%.
  { section: 'uncertified_gold', product: '$1 Type I', factor: 0.82 },
  { section: 'uncertified_gold', product: '$1 Type II', factor: 0.82 },
  { section: 'uncertified_gold', product: '$1 Type III', factor: 0.82 },
  { section: 'uncertified_gold', product: '$3 Gold', factor: 0.82 },
  // $2.5 Liberty/Indian + $5 Indian + $10 Indian on Sheet1 are
  // "SEE AG&C BUY RATES" — no RARCOA markdown, AGC uses its own
  // pricing rule. Leave them absent so lookup() returns null and
  // the admin UI shows "— use AGC rates —".

  // Certified gold — per-row factors from Sheet1 rows 31-44.
  // Base factor = clean; spots_factor = clean-price × X%.
  { section: 'certified_gold', product: '$1 Type I', factor: 0.85, spots_factor: 0.92 },
  { section: 'certified_gold', product: '$1 Type II', factor: 0.85, spots_factor: 0.92 },
  { section: 'certified_gold', product: '$1 Type III', factor: 0.85, spots_factor: 0.92 },
  { section: 'certified_gold', product: '$2.5 Liberty', factor: 0.85, spots_factor: 0.94 },
  { section: 'certified_gold', product: '$2.5 Indian', factor: 0.90, spots_factor: 0.93 },
  { section: 'certified_gold', product: '$3 Gold', factor: 0.90, spots_factor: 0.92 },
  { section: 'certified_gold', product: '$5 Liberty', factor: 0.90, spots_factor: 0.95 },
  { section: 'certified_gold', product: '$5 Indian', factor: 0.90, spots_factor: 0.94 },
  { section: 'certified_gold', product: '$10 Liberty', factor: 0.90, spots_factor: 0.96 },
  { section: 'certified_gold', product: '$10 Indian', factor: 0.90, spots_factor: 0.96 },
  { section: 'certified_gold', product: '$20 Liberty', factor: 0.95, spots_factor: 0.98 },
  { section: 'certified_gold', product: '$20 High Relief', factor: 0.92, spots_factor: 0.92 },
  { section: 'certified_gold', product: '$20 St. Gaudens NM', factor: 0.95, spots_factor: 0.98 },
  { section: 'certified_gold', product: '$20 St. Gaudens', factor: 0.95, spots_factor: 0.98 },

  // Silver dollars — NGC/PCGS clean = 85%, toned = 75%.
  // Applied uniformly across MS-63..MS-67 for both Morgan + Peace
  // (Sheet1 rows 49-53). Tone is handled via a separate `tone`
  // dimension on the markdown rather than a different grade so the
  // admin UI can toggle between clean/toned in one view.
  { section: 'morgan_dollar', product: 'MS-63', factor: 0.85, tone: 'clean' },
  { section: 'morgan_dollar', product: 'MS-63', factor: 0.75, tone: 'toned' },
  { section: 'morgan_dollar', product: 'MS-64', factor: 0.85, tone: 'clean' },
  { section: 'morgan_dollar', product: 'MS-64', factor: 0.75, tone: 'toned' },
  { section: 'morgan_dollar', product: 'MS-65', factor: 0.85, tone: 'clean' },
  { section: 'morgan_dollar', product: 'MS-65', factor: 0.75, tone: 'toned' },
  { section: 'morgan_dollar', product: 'MS-66', factor: 0.85, tone: 'clean' },
  { section: 'morgan_dollar', product: 'MS-66', factor: 0.75, tone: 'toned' },
  { section: 'morgan_dollar', product: 'MS-67', factor: 0.85, tone: 'clean' },
  { section: 'morgan_dollar', product: 'MS-67', factor: 0.75, tone: 'toned' },
  { section: 'peace_dollar', product: 'MS-63', factor: 0.85, tone: 'clean' },
  { section: 'peace_dollar', product: 'MS-63', factor: 0.75, tone: 'toned' },
  { section: 'peace_dollar', product: 'MS-64', factor: 0.85, tone: 'clean' },
  { section: 'peace_dollar', product: 'MS-64', factor: 0.75, tone: 'toned' },
  { section: 'peace_dollar', product: 'MS-65', factor: 0.85, tone: 'clean' },
  { section: 'peace_dollar', product: 'MS-65', factor: 0.75, tone: 'toned' },
  { section: 'peace_dollar', product: 'MS-66', factor: 0.85, tone: 'clean' },
  { section: 'peace_dollar', product: 'MS-66', factor: 0.75, tone: 'toned' },
  { section: 'peace_dollar', product: 'MS-67', factor: 0.85, tone: 'clean' },
  { section: 'peace_dollar', product: 'MS-67', factor: 0.75, tone: 'toned' },
];

/**
 * Find the markdown that applies to a given (section, product [,
 * grade] [, tone]) tuple. Returns null when no entry matches — the
 * admin UI treats null as "AGC uses its own rates" (matches Sheet1
 * "SEE AG&C BUY RATES" cells).
 */
export function lookupMarkdown(
  key: MarkdownKey,
): RarcoaMarkdown | null {
  const hit = MARKDOWNS.find(
    (m) =>
      m.section === key.section &&
      m.product === key.product &&
      (m.grade ? m.grade === key.grade : true) &&
      (m.tone ? m.tone === (key.tone ?? 'clean') : true),
  );
  if (!hit) return null;
  return { factor: hit.factor, spots_factor: hit.spots_factor };
}

/** Apply a markdown factor; returns null if raw_bid was null. */
export function applyMarkdown(
  raw_bid: number | null,
  factor: number,
): number | null {
  if (raw_bid === null || raw_bid === undefined) return null;
  return Math.round(raw_bid * factor * 100) / 100;
}
