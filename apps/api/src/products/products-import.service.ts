import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, Metal, ProductCategory } from '../db/types';
import { d, toDbString } from '../common/money';
import { PublicCacheService } from '../public/public-cache.service';

type Cell = string;
type Row = Record<string, Cell>;

export interface PreviewRow {
  row_number: number;         // 1-based, including header (so 2 = first data row)
  sku: string;
  name: string;
  metal: string;
  category: string;
  weight_troy_oz: string;
  purity: string;
  show_on_website: boolean;
  description: string | null;
  /** 'create' = new SKU, 'update' = existing SKU, 'error' = validation failed. */
  action: 'create' | 'update' | 'error';
  error: string | null;
}

export interface PreviewResult {
  total: number;
  to_create: number;
  to_update: number;
  errors: number;
  rows: PreviewRow[];
}

const ALLOWED_METALS: ReadonlySet<Metal> = new Set(['gold', 'silver', 'platinum', 'palladium']);
const ALLOWED_CATEGORIES: ReadonlySet<ProductCategory> = new Set([
  'coin', 'bar', 'round', 'numismatic', 'jewelry', 'other',
]);

// Accepted header aliases so the CSV can tolerate different spreadsheet
// exports (Title case, underscores, friendly labels). All lookups happen on
// the normalized (lowercase, spaces+underscores stripped) key.
const HEADER_MAP: Record<string, string> = {
  sku: 'sku',
  name: 'name',
  productname: 'name',
  metal: 'metal',
  category: 'category',
  type: 'category',
  weight: 'weight_troy_oz',
  weighttroyoz: 'weight_troy_oz',
  weightoz: 'weight_troy_oz',
  troyoz: 'weight_troy_oz',
  purity: 'purity',
  fineness: 'purity',
  description: 'description',
  notes: 'description',
  showonwebsite: 'show_on_website',
  website: 'show_on_website',
  public: 'show_on_website',
};

function normHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '').trim();
}

function parseBool(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 't';
}

/**
 * Tiny RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
 * escaped quotes ("") inside a quoted field, and CRLF line endings. No
 * dependency on a CSV library — keeps the bundle lean.
 */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const s = text.replace(/\uFEFF/g, ''); // strip BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(cell);
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(cell);
        cell = '';
        if (row.length > 1 || row[0] !== '') out.push(row);
        row = [];
      } else {
        cell += c;
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== '') out.push(row);
  }
  if (out.length === 0) return { headers: [], rows: [] };
  return { headers: out[0], rows: out.slice(1) };
}

@Injectable()
export class ProductsImportService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly cache: PublicCacheService,
  ) {}

  async preview(csvText: string): Promise<PreviewResult> {
    const { headers, rows } = parseCsv(csvText);
    const keyByIdx: (string | null)[] = headers.map((h) => HEADER_MAP[normHeader(h)] ?? null);

    const required = ['sku', 'name', 'metal', 'category', 'weight_troy_oz', 'purity'];
    const missing = required.filter((r) => !keyByIdx.includes(r));
    if (missing.length > 0) {
      return {
        total: 0, to_create: 0, to_update: 0, errors: 1,
        rows: [{
          row_number: 1, sku: '', name: '', metal: '', category: '',
          weight_troy_oz: '', purity: '', show_on_website: false, description: null,
          action: 'error',
          error: `CSV missing required columns: ${missing.join(', ')}`,
        }],
      };
    }

    // Pre-fetch existing SKUs in one query.
    const inputSkus = rows.map((r) => this.cell(r, keyByIdx, 'sku'))
      .map((s) => s.trim())
      .filter(Boolean);
    const existing = inputSkus.length === 0 ? [] :
      await this.db.selectFrom('products').select('sku').where('sku', 'in', inputSkus).execute();
    const existingSet = new Set(existing.map((x) => x.sku));

    const out: PreviewRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2;
      const row: Row = {};
      headers.forEach((_, idx) => {
        const key = keyByIdx[idx];
        if (key) row[key] = (rows[i][idx] ?? '').trim();
      });

      const err = this.validate(row);
      const sku = (row.sku ?? '').toUpperCase();
      if (err) {
        out.push({
          row_number: rowNumber, sku, name: row.name ?? '', metal: row.metal ?? '',
          category: row.category ?? '', weight_troy_oz: row.weight_troy_oz ?? '',
          purity: row.purity ?? '', show_on_website: false,
          description: row.description || null,
          action: 'error', error: err,
        });
        continue;
      }

      out.push({
        row_number: rowNumber,
        sku,
        name: row.name,
        metal: row.metal.toLowerCase(),
        category: row.category.toLowerCase(),
        weight_troy_oz: row.weight_troy_oz,
        purity: row.purity,
        show_on_website: row.show_on_website !== undefined ? parseBool(row.show_on_website) : false,
        description: row.description || null,
        action: existingSet.has(sku) ? 'update' : 'create',
        error: null,
      });
    }

    return {
      total: out.length,
      to_create: out.filter((r) => r.action === 'create').length,
      to_update: out.filter((r) => r.action === 'update').length,
      errors:    out.filter((r) => r.action === 'error').length,
      rows: out,
    };
  }

  /**
   * Commit an already-previewed import. Skips error rows; upserts the rest in
   * a single transaction so the catalog never lands in a partial state. Bumps
   * the public cache when done so /public/what-we-pay reflects new stock.
   */
  async commit(csvText: string): Promise<{ created: number; updated: number; skipped: number }> {
    const preview = await this.preview(csvText);
    const valid = preview.rows.filter((r) => r.action !== 'error');
    let created = 0;
    let updated = 0;

    await this.db.transaction().execute(async (trx) => {
      for (const r of valid) {
        const content = d(r.weight_troy_oz).times(d(r.purity));
        if (r.action === 'create') {
          await trx.insertInto('products').values({
            sku: r.sku,
            name: r.name,
            metal: r.metal as Metal,
            category: r.category as ProductCategory,
            weight_troy_oz: toDbString(r.weight_troy_oz),
            purity: toDbString(r.purity),
            metal_content_troy_oz: toDbString(content),
            description: r.description,
            show_on_website: r.show_on_website,
            is_active: true,
          }).execute();
          created++;
        } else {
          // Update every field EXCEPT is_active — re-importing shouldn't
          // silently reactivate a deliberately-disabled product.
          await trx.updateTable('products')
            .set({
              name: r.name,
              metal: r.metal as Metal,
              category: r.category as ProductCategory,
              weight_troy_oz: toDbString(r.weight_troy_oz),
              purity: toDbString(r.purity),
              metal_content_troy_oz: toDbString(content),
              description: r.description,
              show_on_website: r.show_on_website,
            })
            .where('sku', '=', r.sku)
            .execute();
          updated++;
        }
      }
    });

    if (created + updated > 0) {
      await this.cache.invalidatePricingDependent();
    }
    return { created, updated, skipped: preview.errors };
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private cell(row: string[], keyByIdx: (string | null)[], key: string): string {
    const idx = keyByIdx.indexOf(key);
    return idx >= 0 ? (row[idx] ?? '') : '';
  }

  private validate(row: Row): string | null {
    if (!row.sku) return 'sku is required';
    if (!/^[A-Z0-9_-]+$/i.test(row.sku)) return 'sku must be alphanumeric with - or _';
    if (!row.name) return 'name is required';
    if (!row.metal || !ALLOWED_METALS.has(row.metal.toLowerCase() as Metal)) {
      return `metal must be one of ${[...ALLOWED_METALS].join(', ')}`;
    }
    if (!row.category || !ALLOWED_CATEGORIES.has(row.category.toLowerCase() as ProductCategory)) {
      return `category must be one of ${[...ALLOWED_CATEGORIES].join(', ')}`;
    }
    const weight = Number(row.weight_troy_oz);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100_000) {
      return 'weight_troy_oz must be a positive number';
    }
    const purity = Number(row.purity);
    if (!Number.isFinite(purity) || purity <= 0 || purity > 1) {
      return 'purity must be between 0 and 1';
    }
    return null;
  }
}
