import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, KpiManualCategory } from '../db/types';
import { toDbString } from '../common/money';

export interface ManualEntryRow {
  id: string;
  bucket_month: string; // ISO YYYY-MM-01
  category: KpiManualCategory;
  client_id: string | null;
  client_name: string | null;
  amount: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Manual KPI entries — back-dated sales / purchases / wholesale
 * numbers for months before AGC Desk went live (migration 027).
 *
 * Why the table exists: the live KPI timeline and the dashboard's
 * 12-month chart read their data from the invoices table. Months
 * that predate this system look empty. Operators need a place to
 * enter consolidated historical totals so year-over-year trends
 * stay meaningful.
 *
 * Granularity is monthly. Wholesale entries can (and usually
 * should) carry a client_id so the data stays tied to the specific
 * wholesaler it came from — the chart still renders them rolled up
 * into a single "wholesale" series, but per-partner historical
 * reconstruction is possible later.
 *
 * Rules the service enforces:
 *   - bucket_month must be YYYY-MM-01 (validated at the DTO layer).
 *   - amount is non-negative numeric(20,2).
 *   - client_id, if provided, must belong to a real client; we
 *     don't enforce wholesaler vs retail at write-time because the
 *     operator might be historicizing a client that's since been
 *     reclassified.
 */
@Injectable()
export class KpiManualEntriesService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /**
   * List entries with optional filters. Includes the client's
   * display name joined in so the admin UI can render "$X — Acme
   * Coin" without a second fetch. Returns rows ordered newest-
   * bucket-first for the admin table UX.
   */
  async list(opts: {
    fromMonth?: string;
    toMonth?: string;
    category?: KpiManualCategory;
  } = {}): Promise<ManualEntryRow[]> {
    let q = this.db
      .selectFrom('kpi_manual_entries as e')
      .leftJoin('clients as c', 'c.id', 'e.client_id')
      .select([
        'e.id',
        sql<string>`to_char(e.bucket_month, 'YYYY-MM-DD')`.as('bucket_month'),
        'e.category',
        'e.client_id',
        sql<string | null>`coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.company)`.as(
          'client_name',
        ),
        'e.amount',
        'e.notes',
        'e.created_at',
        'e.updated_at',
      ])
      .orderBy('e.bucket_month', 'desc')
      .orderBy('e.category');

    // Kysely's bucket_month column is typed as Date on selects; the
    // operator passes a YYYY-MM-DD string. sql<boolean> nudges the
    // comparison into SQL-land — Postgres casts the text literal to
    // date automatically on the server side.
    if (opts.fromMonth)
      q = q.where(sql<boolean>`e.bucket_month >= ${opts.fromMonth}::date`);
    if (opts.toMonth)
      q = q.where(sql<boolean>`e.bucket_month <= ${opts.toMonth}::date`);
    if (opts.category) q = q.where('e.category', '=', opts.category);

    return q.execute() as unknown as Promise<ManualEntryRow[]>;
  }

  async create(input: {
    bucket_month: string;
    category: KpiManualCategory;
    client_id?: string | null;
    amount: number;
    notes?: string;
  }): Promise<ManualEntryRow> {
    let inserted: { id: string };
    try {
      inserted = await this.db
        .insertInto('kpi_manual_entries')
        .values({
          bucket_month: input.bucket_month,
          category: input.category,
          client_id: input.client_id ?? null,
          amount: toDbString(input.amount),
          notes: input.notes ?? null,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
    } catch (err) {
      throw translatePgError(err, {
        category: input.category,
        client_id: input.client_id ?? null,
      });
    }
    return this.getById(inserted.id);
  }

  async update(
    id: string,
    patch: {
      bucket_month?: string;
      category?: KpiManualCategory;
      client_id?: string | null;
      amount?: number;
      notes?: string | null;
    },
  ): Promise<ManualEntryRow> {
    const existing = await this.db
      .selectFrom('kpi_manual_entries')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) throw new NotFoundException('Entry not found');

    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.bucket_month !== undefined) set.bucket_month = patch.bucket_month;
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.client_id !== undefined) set.client_id = patch.client_id;
    if (patch.amount !== undefined) set.amount = toDbString(patch.amount);
    if (patch.notes !== undefined) set.notes = patch.notes;

    try {
      await this.db
        .updateTable('kpi_manual_entries')
        .set(set)
        .where('id', '=', id)
        .execute();
    } catch (err) {
      throw translatePgError(err, {
        category: (patch.category as KpiManualCategory | undefined) ?? null,
        client_id: patch.client_id ?? null,
      });
    }

    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('kpi_manual_entries')
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numDeletedRows) === 0) {
      throw new NotFoundException('Entry not found');
    }
  }

  async getById(id: string): Promise<ManualEntryRow> {
    const row = await this.db
      .selectFrom('kpi_manual_entries as e')
      .leftJoin('clients as c', 'c.id', 'e.client_id')
      .select([
        'e.id',
        sql<string>`to_char(e.bucket_month, 'YYYY-MM-DD')`.as('bucket_month'),
        'e.category',
        'e.client_id',
        sql<string | null>`coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.company)`.as(
          'client_name',
        ),
        'e.amount',
        'e.notes',
        'e.created_at',
        'e.updated_at',
      ])
      .where('e.id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Entry not found');
    return row as unknown as ManualEntryRow;
  }
}

/**
 * Turn raw Postgres errors into HTTP errors with actionable copy.
 * Previously a bad client_id / bad month / out-of-range amount
 * surfaced as a generic 500 "Internal server error" that left the
 * accountant guessing. We map the PG SQLSTATE codes to BadRequest
 * with the real reason; everything else falls through as a 500 so
 * the original stack still hits Railway logs.
 *
 * Codes we translate:
 *   23503 foreign_key_violation       → wrong client_id
 *   23514 check_violation              → category not in allowed list
 *   22P02 invalid_text_representation  → bad UUID / bad date
 *   22001 string_data_right_truncation → notes over length cap
 *   22003 numeric_value_out_of_range   → amount too big
 */
function translatePgError(
  err: unknown,
  ctx: { category: KpiManualCategory | null; client_id: string | null },
): Error {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case '23503':
      return new BadRequestException(
        ctx.client_id
          ? `The wholesaler you selected (client id ${ctx.client_id}) no longer exists in the clients table. Pick a different wholesaler.`
          : 'A referenced record was missing. Refresh the form and try again.',
      );
    case '23514':
      return new BadRequestException(
        `Category "${ctx.category ?? ''}" is not one of sales / purchases / wholesale.`,
      );
    case '22P02':
      return new BadRequestException(
        'A date or id field was malformed. Month must be YYYY-MM-01 and the wholesaler must be picked from the dropdown (not typed).',
      );
    case '22001':
      return new BadRequestException('Notes are too long (max 500 characters).');
    case '22003':
      return new BadRequestException(
        'Amount is out of range for this column (numeric(20,2)). Are there too many digits, or a bad decimal value?',
      );
    default:
      return new InternalServerErrorException(
        `KPI entry save failed. ${(err as Error)?.message ?? ''}`.trim(),
      );
  }
}
