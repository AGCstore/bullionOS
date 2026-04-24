import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * RARCOA goldsheet PDF parser.
 *
 * RARCOA (rarcoa.com) is the wholesale dealer AGC buys from. They
 * email a daily PDF ("goldsheet") with buy/sell indications across
 * uncertified gold, certified MS61-MS66 gold, and certified Morgan/
 * Peace silver dollars. AGC operators used to copy these into a
 * Google Sheet manually; this parser replaces that step.
 *
 * PDF structure (verified against the Apr 23 2026 sample):
 *   1. Header noise (logo + static contact block)
 *   2. "Quotes as of: M/D/YY HH:MM"
 *   3. Basis gold (just a float on its own line)
 *   4. 12 rows of 4 "bid / ask" cells — uncertified gold:
 *        rows 1-8  = small gold ($1 Type I-III, $2.5 Lib, $2.5 Ind,
 *                    $3 Gold, $5 Ind, $10 Ind)   × cols VF/XF/AU/BU
 *        rows 9-12 = large gold ($5/$10/$20 Lib, $20 Gaudens)
 *                    × cols LP/LT POL / VF/XF / AU/CU / Uncirculated
 *   5. 14 rows of 6 cells — certified gold (MS61-MS66)
 *   6. 5 rows of 4 cells — silver dollars (Morgan NGC, Morgan PCGS,
 *        Peace NGC, Peace PCGS)   × MS-63..MS-67
 *
 * Cell value shapes we handle:
 *   "380 / 435"       → bid=380, ask=435
 *   "380/435"         → same (silver uses no-space variant)
 *   "485 / -"         → bid=485, ask=null
 *   "- / -"           → bid=null, ask=null
 *   "Call / -"        → bid=null (Call), ask=null
 *   "N16750 / 20750"  → bid=16750, ask=20750, ngc_only=true
 *   "NCall / -"       → null/null, ngc_only=true
 *
 * The parser is deliberately position-based against this known
 * grid. If RARCOA ever reshapes their sheet (add a row, swap a
 * column), the extract-and-label step below will emit the wrong
 * labels silently — but the operator will see mismatched prices on
 * the admin snapshot within a day. A more defensive pass over
 * section headers could be added later if that becomes a real risk.
 */

export interface ParsedRarcoaCell {
  section: RarcoaSection;
  product: string;
  grade: string;
  raw_bid: number | null;
  raw_ask: number | null;
  ngc_only: boolean;
}

export type RarcoaSection =
  | 'uncertified_gold'
  | 'uncertified_large_gold'
  | 'certified_gold'
  | 'morgan_dollar'
  | 'peace_dollar';

export interface ParsedRarcoaSheet {
  as_of_date: string; // YYYY-MM-DD
  as_of_time: string; // "11:08 AM ET" or just "11:08"
  basis_gold: number | null;
  cells: ParsedRarcoaCell[];
}

const UNCERT_SMALL_ROWS = [
  '$1 Type I',
  '$1 Type II',
  '$1 Type III',
  '$2.5 Liberty',
  '$2.5 Indian',
  '$3 Gold',
  '$5 Indian',
  '$10 Indian',
];
const UNCERT_SMALL_COLS = ['VF', 'XF', 'AU', 'BU'];

const UNCERT_LARGE_ROWS = [
  '$5 Liberty',
  '$10 Liberty',
  '$20 Liberty',
  '$20 St. Gaudens',
];
const UNCERT_LARGE_COLS = ['LP/LT POL', 'VF/XF', 'AU/CU', 'Uncirculated'];

const CERT_GOLD_ROWS = [
  '$1 Type I',
  '$1 Type II',
  '$1 Type III',
  '$2.5 Liberty',
  '$2.5 Indian',
  '$3 Gold',
  '$5 Liberty',
  '$5 Indian',
  '$10 Liberty',
  '$10 Indian',
  '$20 Liberty',
  '$20 High Relief',
  '$20 St. Gaudens NM',
  '$20 St. Gaudens',
];
const CERT_GOLD_COLS = ['MS61', 'MS62', 'MS63', 'MS64', 'MS65', 'MS66'];

const SILVER_ROWS = ['MS-63', 'MS-64', 'MS-65', 'MS-66', 'MS-67'];

@Injectable()
export class RarcoaParserService {
  /**
   * Parse the plaintext output of the RARCOA goldsheet PDF into a
   * structured snapshot. Throws BadRequestException with a pointer
   * to the offending line when the input doesn't match the known
   * shape — the operator then sees "RARCOA sheet doesn't match the
   * expected layout; please forward to support" instead of a silent
   * mis-parse.
   */
  parseText(text: string): ParsedRarcoaSheet {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // 1. Find the "Quotes as of: …" line. Everything above it is
    //    header noise we don't need.
    const headerIdx = lines.findIndex((l) => /^Quotes as of:/i.test(l));
    if (headerIdx < 0) {
      throw new BadRequestException(
        'RARCOA PDF missing the "Quotes as of:" header line. Confirm you uploaded the correct goldsheet.',
      );
    }
    const headerLine = lines[headerIdx];
    const headerMatch = headerLine.match(
      /Quotes as of:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})/i,
    );
    if (!headerMatch) {
      throw new BadRequestException(
        `RARCOA header didn't match the expected date/time format. Got: "${headerLine}"`,
      );
    }
    const as_of_date = parseUsDate(headerMatch[1]);
    const as_of_time = headerMatch[2];

    // 2. Next line = basis gold (just a float).
    const basisLine = lines[headerIdx + 1] ?? '';
    const basisMatch = basisLine.match(/^([\d,]+\.\d{1,4})$/);
    const basis_gold = basisMatch
      ? Number(basisMatch[1].replace(/,/g, ''))
      : null;

    // 3. Body starts either right after the basis line (when one was
    //    found) or right after the header line.
    const bodyStart = basis_gold !== null ? headerIdx + 2 : headerIdx + 1;
    const body = lines.slice(bodyStart);

    // Expected body shape:
    //   12 lines × 4 cells  (uncertified gold: 8 small + 4 large)
    //   14 lines × 6 cells  (certified gold MS61-MS66)
    //    5 lines × 4 cells  (silver dollar grid)
    // Total = 31 rows.
    const cells: ParsedRarcoaCell[] = [];

    const uncertSmall = body.slice(0, 8);
    for (let r = 0; r < UNCERT_SMALL_ROWS.length; r++) {
      const row = this.parseRowCells(uncertSmall[r] ?? '', 4);
      row.forEach((cell, c) =>
        cells.push({
          section: 'uncertified_gold',
          product: UNCERT_SMALL_ROWS[r],
          grade: UNCERT_SMALL_COLS[c],
          ...cell,
        }),
      );
    }

    const uncertLarge = body.slice(8, 12);
    for (let r = 0; r < UNCERT_LARGE_ROWS.length; r++) {
      const row = this.parseRowCells(uncertLarge[r] ?? '', 4);
      row.forEach((cell, c) =>
        cells.push({
          section: 'uncertified_large_gold',
          product: UNCERT_LARGE_ROWS[r],
          grade: UNCERT_LARGE_COLS[c],
          ...cell,
        }),
      );
    }

    const certGold = body.slice(12, 26);
    for (let r = 0; r < CERT_GOLD_ROWS.length; r++) {
      const row = this.parseRowCells(certGold[r] ?? '', 6);
      row.forEach((cell, c) =>
        cells.push({
          section: 'certified_gold',
          product: CERT_GOLD_ROWS[r],
          grade: CERT_GOLD_COLS[c],
          ...cell,
        }),
      );
    }

    const silver = body.slice(26, 31);
    for (let r = 0; r < SILVER_ROWS.length; r++) {
      const row = this.parseRowCells(silver[r] ?? '', 4);
      // 4 cells per row = Morgan NGC, Morgan PCGS, Peace NGC, Peace PCGS.
      // Flatten into two sections (morgan_dollar + peace_dollar) with
      // the grading house in the `grade` column — matches the Sheet3
      // column headers and keeps downstream markdown lookups simple.
      const [morganNgc, morganPcgs, peaceNgc, peacePcgs] = row;
      if (morganNgc)
        cells.push({
          section: 'morgan_dollar',
          product: SILVER_ROWS[r],
          grade: 'NGC',
          ...morganNgc,
        });
      if (morganPcgs)
        cells.push({
          section: 'morgan_dollar',
          product: SILVER_ROWS[r],
          grade: 'PCGS',
          ...morganPcgs,
        });
      if (peaceNgc)
        cells.push({
          section: 'peace_dollar',
          product: SILVER_ROWS[r],
          grade: 'NGC',
          ...peaceNgc,
        });
      if (peacePcgs)
        cells.push({
          section: 'peace_dollar',
          product: SILVER_ROWS[r],
          grade: 'PCGS',
          ...peacePcgs,
        });
    }

    return { as_of_date, as_of_time, basis_gold, cells };
  }

  /**
   * Pull N "bid / ask" cells out of a single line. Each cell is a
   * token-pair like "380 / 435", "485 / -", or "N16750 / 20750"
   * optionally no-space (silver). Regex below matches the full
   * token set we've seen in the wild; returns `{ raw_bid, raw_ask,
   * ngc_only }` per cell, preserving order.
   */
  private parseRowCells(
    line: string,
    expected: number,
  ): Array<{
    raw_bid: number | null;
    raw_ask: number | null;
    ngc_only: boolean;
  }> {
    if (!line) {
      return Array(expected).fill({ raw_bid: null, raw_ask: null, ngc_only: false });
    }
    // Each cell side is: optional 'N' prefix, then (number | '-' | 'Call').
    // Slash separator can have 0-2 spaces either side.
    const cellRe = /(N)?([\d,]+(?:\.\d+)?|-|Call)\s*\/\s*(N)?([\d,]+(?:\.\d+)?|-|Call)/gi;
    const out: Array<{
      raw_bid: number | null;
      raw_ask: number | null;
      ngc_only: boolean;
    }> = [];
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(line)) !== null) {
      out.push({
        raw_bid: toNumOrNull(m[2]),
        raw_ask: toNumOrNull(m[4]),
        ngc_only: Boolean(m[1] || m[3]),
      });
    }
    // Pad to `expected` in case RARCOA left trailing blanks. Caller
    // doesn't have to guard against short rows this way.
    while (out.length < expected) {
      out.push({ raw_bid: null, raw_ask: null, ngc_only: false });
    }
    return out;
  }
}

function toNumOrNull(token: string | undefined): number | null {
  if (!token) return null;
  if (token === '-' || /^call$/i.test(token)) return null;
  const n = Number(token.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "4/23/26" → "2026-04-23". Two-digit years assume 20xx. */
function parseUsDate(s: string): string {
  const [mRaw, dRaw, yRaw] = s.split('/');
  let y = Number(yRaw);
  if (y < 100) y = 2000 + y;
  const m = String(Number(mRaw)).padStart(2, '0');
  const d = String(Number(dRaw)).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
