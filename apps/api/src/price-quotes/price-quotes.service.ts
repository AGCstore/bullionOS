import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, PriceQuote } from '../db/types';
import { PricingService } from '../pricing/pricing.service';
import { toDbString, d, toDisplay } from '../common/money';
import type { CreateQuoteDto } from './dto/create-quote.dto';

const DEFAULT_TTL_MIN = 15;
const MAX_TTL_MIN = 60;

@Injectable()
export class PriceQuotesService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly pricing: PricingService,
  ) {}

  async resolveClientForUser(userId: string): Promise<string> {
    const row = await this.db
      .selectFrom('clients')
      .select('id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) throw new ForbiddenException('No client profile');
    return row.id;
  }

  async create(userId: string, dto: CreateQuoteDto): Promise<PriceQuote> {
    const clientId = await this.resolveClientForUser(userId);

    const ttl = Math.min(dto.ttl_minutes ?? DEFAULT_TTL_MIN, MAX_TTL_MIN);
    const quote = await this.pricing.quote(dto.product_id, dto.quantity);
    const unit = dto.side === 'sell' ? quote.sell_unit_price : quote.buy_unit_price;
    const lineTotal = d(unit).times(dto.quantity);
    const premiumType = dto.side === 'sell' ? quote.sell_premium_type : quote.buy_premium_type;
    const premiumValue = dto.side === 'sell' ? quote.sell_premium_value : quote.buy_premium_value;

    return this.db
      .insertInto('price_quotes')
      .values({
        client_id: clientId,
        product_id: dto.product_id,
        side: dto.side,
        quantity: dto.quantity,
        spot_price_per_oz: quote.spot_per_oz,
        unit_price: toDbString(unit),
        line_total: toDbString(lineTotal),
        premium_type: premiumType,
        premium_value: premiumValue,
        expires_at: new Date(Date.now() + ttl * 60_000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  listForClientUser(userId: string) {
    return this.resolveClientForUser(userId).then((clientId) =>
      this.db
        .selectFrom('price_quotes as q')
        .innerJoin('products as p', 'p.id', 'q.product_id')
        .selectAll('q')
        .select(['p.name as product_name', 'p.sku as product_sku', 'p.metal as product_metal'])
        .where('q.client_id', '=', clientId)
        .orderBy('q.created_at', 'desc')
        .limit(100)
        .execute(),
    );
  }

  async getById(id: string) {
    const row = await this.db
      .selectFrom('price_quotes as q')
      .innerJoin('products as p', 'p.id', 'q.product_id')
      .innerJoin('clients as c', 'c.id', 'q.client_id')
      .selectAll('q')
      .select([
        'p.name as product_name',
        'p.sku as product_sku',
        'p.metal as product_metal',
        sql<string>`c.first_name || ' ' || c.last_name`.as('client_name'),
      ])
      .where('q.id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Quote not found');
    return row;
  }

  /**
   * Convert a still-valid quote into a draft invoice at the locked price.
   * Enforced admin-only at controller level.
   */
  async convertToInvoice(
    id: string,
    actorUserId: string,
  ): Promise<{ invoice_id: string; invoice_number: string; total: string }> {
    const quote = await this.db
      .selectFrom('price_quotes')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.converted_invoice_id) {
      throw new BadRequestException('Quote already converted');
    }
    if (quote.expires_at.getTime() < Date.now()) {
      throw new BadRequestException('Quote has expired');
    }

    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'metal', 'metal_content_troy_oz'])
      .where('id', '=', quote.product_id)
      .executeTakeFirstOrThrow();

    return this.db.transaction().execute(async (trx) => {
      // Allocate invoice_number from the existing sequence.
      const { rows } = await sql<{ nextval: string }>`select nextval('invoice_number_seq')`.execute(trx);
      const year = new Date().getUTCFullYear();
      const invoiceNumber = `${year}-${String(rows[0].nextval).padStart(6, '0')}`;

      const invoice = await trx
        .insertInto('invoices')
        .values({
          invoice_number: invoiceNumber,
          client_id: quote.client_id,
          type: quote.side,
          status: 'draft',
          subtotal: quote.line_total,
          tax: '0',
          shipping: '0',
          total: quote.line_total,
          payment_method: null,
          notes: `Converted from locked quote (exp ${quote.expires_at.toISOString()})`,
          created_by_user_id: actorUserId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('invoice_line_items')
        .values({
          invoice_id: invoice.id,
          product_id: product.id,
          position: 1,
          quantity: quote.quantity,
          product_name_snapshot: product.name,
          unit_weight_troy_oz: product.metal_content_troy_oz,
          unit_purity: '1',
          unit_metal_content_troy_oz: product.metal_content_troy_oz,
          spot_price_per_oz: quote.spot_price_per_oz,
          premium_type: quote.premium_type,
          premium_value: quote.premium_value,
          unit_price: quote.unit_price,
          line_total: quote.line_total,
          is_overridden: false,
        })
        .execute();

      await trx
        .updateTable('price_quotes')
        .set({ converted_invoice_id: invoice.id })
        .where('id', '=', quote.id)
        .execute();

      await trx
        .insertInto('audit_logs')
        .values({
          actor_user_id: actorUserId,
          action: 'price_quote.convert',
          entity_type: 'price_quote',
          entity_id: quote.id,
          metadata: sql`${JSON.stringify({
            invoice_id: invoice.id,
            invoice_number: invoiceNumber,
            locked_unit_price: quote.unit_price,
          })}::jsonb`,
        })
        .execute();

      return {
        invoice_id: invoice.id,
        invoice_number: invoiceNumber,
        total: toDisplay(quote.line_total, 2),
      };
    });
  }
}
