import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { PDFParse } from 'pdf-parse';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';
import { toDbString } from '../common/money';
import {
  RarcoaParserService,
  type ParsedRarcoaSheet,
} from './rarcoa-parser.service';
import { applyMarkdown, lookupMarkdown } from './rarcoa-markdowns';

export interface RarcoaSnapshotCell {
  section: string;
  product: string;
  grade: string;
  raw_bid: number | null;
  raw_ask: number | null;
  ngc_only: boolean;
  agc_clean: number | null;
  agc_spots: number | null;
  agc_toned: number | null;
}

export interface RarcoaSnapshot {
  sheet_id: string | null;
  as_of_date: string | null;
  as_of_time: string | null;
  basis_gold: number | null;
  ingested_at: Date | null;
  ingested_by_user_id: string | null;
  cells: RarcoaSnapshotCell[];
}

/**
 * RARCOA pricing ingest + query service.
 *
 * Workflow (Phase 1):
 *   1. Admin uploads the daily goldsheet PDF at /admin/rarcoa.
 *   2. ingestPdf() parses the PDF, upserts a supplier_price_sheets
 *      row keyed on (supplier='rarcoa', as_of_date), and replaces all
 *      supplier_prices rows for that sheet. Re-uploading the same
 *      day's sheet is idempotent.
 *   3. getLatest() / getByDate() return a flattened snapshot the UI
 *      renders, enriched with AGC marked-down prices.
 *
 * Phase 2 (not in this patch): Gmail API listener auto-fires the
 * same ingestPdf() path when the daily RARCOA email lands in
 * sales@atlantagoldandcoinbuyers.com. `source_ref` +
 * `source_filename` on the sheet row carry the provenance.
 */
@Injectable()
export class RarcoaService {
  private readonly logger = new Logger(RarcoaService.name);
  private static readonly SUPPLIER = 'rarcoa';

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly parser: RarcoaParserService,
  ) {}

  /**
   * Parse + persist a RARCOA goldsheet PDF. Returns the snapshot as
   * it now sits in the DB so the caller (admin page) can render it
   * without a follow-up GET.
   */
  async ingestPdf(args: {
    pdfBuffer: Buffer;
    filename: string | null;
    ingestedByUserId: string | null;
  }): Promise<RarcoaSnapshot> {
    let text: string;
    try {
      const pdf = new PDFParse({ data: args.pdfBuffer });
      const res = await pdf.getText();
      text = res.text;
    } catch (err) {
      throw new BadRequestException(
        `Failed to extract text from PDF: ${(err as Error).message}`,
      );
    }

    const parsed = this.parser.parseText(text);
    return this.persist(parsed, {
      filename: args.filename,
      ingestedByUserId: args.ingestedByUserId,
      rawText: text,
      sourceRef: 'upload',
    });
  }

  /**
   * Persist a parsed sheet. UPSERTs on (supplier, as_of_date) so a
   * re-upload of the same day replaces the prior snapshot rather
   * than accumulating duplicates. Wraps the price-row inserts in a
   * transaction so an orphaned header can't exist if the child
   * inserts fail partway.
   */
  private async persist(
    parsed: ParsedRarcoaSheet,
    meta: {
      filename: string | null;
      ingestedByUserId: string | null;
      rawText: string;
      sourceRef: string;
    },
  ): Promise<RarcoaSnapshot> {
    const sheet = await this.db.transaction().execute(async (trx) => {
      // UPSERT the sheet header. On conflict we refresh the
      // timestamps + basis + raw_text with the new upload, then
      // wipe out the old price rows and re-insert below. Simpler
      // than diffing row-by-row and the daily volume is tiny.
      const inserted = await trx
        .insertInto('supplier_price_sheets')
        .values({
          supplier: RarcoaService.SUPPLIER,
          as_of_date: parsed.as_of_date,
          as_of_time: parsed.as_of_time,
          basis_gold:
            parsed.basis_gold !== null ? toDbString(parsed.basis_gold) : null,
          source_ref: meta.sourceRef,
          source_filename: meta.filename,
          raw_text: meta.rawText,
          ingested_by_user_id: meta.ingestedByUserId,
        })
        .onConflict((oc) =>
          oc.constraint('supplier_price_sheets_supplier_date_uq').doUpdateSet({
            as_of_time: parsed.as_of_time,
            basis_gold:
              parsed.basis_gold !== null ? toDbString(parsed.basis_gold) : null,
            source_ref: meta.sourceRef,
            source_filename: meta.filename,
            raw_text: meta.rawText,
            ingested_by_user_id: meta.ingestedByUserId,
            ingested_at: new Date(),
          }),
        )
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // Wipe + re-insert price rows. Keeps the idempotency contract
      // simple: one (sheet_id, product, grade) at most.
      await trx
        .deleteFrom('supplier_prices')
        .where('sheet_id', '=', inserted.id)
        .execute();

      if (parsed.cells.length > 0) {
        await trx
          .insertInto('supplier_prices')
          .values(
            parsed.cells.map((c) => ({
              sheet_id: inserted.id,
              supplier: RarcoaService.SUPPLIER,
              section: c.section,
              product: c.product,
              grade: c.grade,
              raw_bid: c.raw_bid !== null ? toDbString(c.raw_bid) : null,
              raw_ask: c.raw_ask !== null ? toDbString(c.raw_ask) : null,
              ngc_only: c.ngc_only,
              as_of_date: parsed.as_of_date,
            })),
          )
          .execute();
      }

      return inserted;
    });

    this.logger.log(
      `RARCOA: ingested ${parsed.cells.length} cells for ${parsed.as_of_date} (sheet ${sheet.id})`,
    );

    const snapshot = await this.getByDate(parsed.as_of_date);
    if (!snapshot) {
      // Should be impossible after a successful persist, but guard
      // anyway so the caller sees a clear error rather than silent
      // null.
      throw new Error('Post-ingest snapshot read failed.');
    }
    return snapshot;
  }

  /** Most recent RARCOA sheet across all dates. Returns null when none. */
  async getLatest(): Promise<RarcoaSnapshot | null> {
    const row = await this.db
      .selectFrom('supplier_price_sheets')
      .select(['id', 'as_of_date'])
      .where('supplier', '=', RarcoaService.SUPPLIER)
      .orderBy('as_of_date', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return this.getByDate(row.as_of_date as unknown as string);
  }

  /**
   * Fetch the snapshot for a specific date (YYYY-MM-DD). Enriches
   * each cell with AGC markdown-computed prices (clean, spots,
   * toned where applicable). Returns null when no sheet exists for
   * that date.
   */
  async getByDate(date: string): Promise<RarcoaSnapshot | null> {
    const sheet = await this.db
      .selectFrom('supplier_price_sheets')
      .selectAll()
      .where('supplier', '=', RarcoaService.SUPPLIER)
      .where(sql<boolean>`as_of_date = ${date}::date`)
      .executeTakeFirst();
    if (!sheet) return null;

    const rows = await this.db
      .selectFrom('supplier_prices')
      .selectAll()
      .where('sheet_id', '=', sheet.id)
      .orderBy('section')
      .orderBy('product')
      .orderBy('grade')
      .execute();

    const cells: RarcoaSnapshotCell[] = rows.map((r) => {
      const rawBid = r.raw_bid !== null ? Number(r.raw_bid) : null;
      const rawAsk = r.raw_ask !== null ? Number(r.raw_ask) : null;
      const section = r.section as
        | 'uncertified_gold'
        | 'uncertified_large_gold'
        | 'certified_gold'
        | 'morgan_dollar'
        | 'peace_dollar';
      const markdown = lookupMarkdown({
        section,
        product: r.product,
        grade: r.grade,
      });
      const tonedMarkdown =
        section === 'morgan_dollar' || section === 'peace_dollar'
          ? lookupMarkdown({
              section,
              product: r.product,
              grade: r.grade,
              tone: 'toned',
            })
          : null;
      const agc_clean = markdown ? applyMarkdown(rawBid, markdown.factor) : null;
      const agc_spots =
        markdown && markdown.spots_factor && agc_clean !== null
          ? applyMarkdown(agc_clean, markdown.spots_factor)
          : null;
      const agc_toned = tonedMarkdown
        ? applyMarkdown(rawBid, tonedMarkdown.factor)
        : null;
      return {
        section: r.section,
        product: r.product,
        grade: r.grade,
        raw_bid: rawBid,
        raw_ask: rawAsk,
        ngc_only: r.ngc_only,
        agc_clean,
        agc_spots,
        agc_toned,
      };
    });

    return {
      sheet_id: sheet.id,
      as_of_date: sheet.as_of_date as unknown as string,
      as_of_time: sheet.as_of_time,
      basis_gold: sheet.basis_gold !== null ? Number(sheet.basis_gold) : null,
      ingested_at: sheet.ingested_at,
      ingested_by_user_id: sheet.ingested_by_user_id,
      cells,
    };
  }

  /** Up to `limit` recent sheet headers — for the history picker. */
  async listSheets(limit = 60): Promise<
    Array<{
      id: string;
      as_of_date: string;
      as_of_time: string | null;
      basis_gold: number | null;
      ingested_at: Date;
    }>
  > {
    const rows = await this.db
      .selectFrom('supplier_price_sheets')
      .select([
        'id',
        'as_of_date',
        'as_of_time',
        'basis_gold',
        'ingested_at',
      ])
      .where('supplier', '=', RarcoaService.SUPPLIER)
      .orderBy('as_of_date', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      as_of_date: r.as_of_date as unknown as string,
      as_of_time: r.as_of_time,
      basis_gold: r.basis_gold !== null ? Number(r.basis_gold) : null,
      ingested_at: r.ingested_at,
    }));
  }

  async deleteSheet(id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('supplier_price_sheets')
      .where('id', '=', id)
      .where('supplier', '=', RarcoaService.SUPPLIER)
      .executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) {
      throw new NotFoundException('RARCOA sheet not found');
    }
  }
}
