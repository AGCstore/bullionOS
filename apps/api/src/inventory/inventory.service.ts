import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql, type Transaction } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, InventoryMovementReason } from '../db/types';
import { d, toDbString } from '../common/money';

export interface InventoryRow {
  product_id: string;
  sku: string;
  name: string;
  metal: string;
  category: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  available: number;
  weighted_avg_cost: string;
  last_purchase_price: string | null;
  updated_at: Date;
  show_on_website: boolean;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /** Full inventory rollup for admins. */
  list(): Promise<InventoryRow[]> {
    return this.db
      .selectFrom('products as p')
      .leftJoin('inventory as inv', 'inv.product_id', 'p.id')
      .select([
        'p.id as product_id',
        'p.sku',
        'p.name',
        'p.metal',
        'p.category',
        'p.show_on_website',
        sql<number>`coalesce(inv.quantity_on_hand, 0)`.as('quantity_on_hand'),
        sql<number>`coalesce(inv.quantity_reserved, 0)`.as('quantity_reserved'),
        sql<number>`coalesce(inv.quantity_on_hand, 0) - coalesce(inv.quantity_reserved, 0)`.as('available'),
        sql<string>`coalesce(inv.weighted_avg_cost, '0')::text`.as('weighted_avg_cost'),
        sql<string | null>`inv.last_purchase_price::text`.as('last_purchase_price'),
        sql<Date>`coalesce(inv.updated_at, p.updated_at)`.as('updated_at'),
      ])
      .where('p.is_active', '=', true)
      .orderBy('p.name')
      .execute() as unknown as Promise<InventoryRow[]>;
  }

  /** Public-shop view: items with positive available stock + flagged for web. */
  inStock(): Promise<Array<Pick<InventoryRow, 'product_id' | 'sku' | 'name' | 'metal' | 'category' | 'available'>>> {
    return this.db
      .selectFrom('products as p')
      .innerJoin('inventory as inv', 'inv.product_id', 'p.id')
      .select([
        'p.id as product_id',
        'p.sku',
        'p.name',
        'p.metal',
        'p.category',
        sql<number>`(inv.quantity_on_hand - inv.quantity_reserved)`.as('available'),
      ])
      .where('p.is_active', '=', true)
      .where('p.show_on_website', '=', true)
      .where(sql<boolean>`(inv.quantity_on_hand - inv.quantity_reserved) > 0`)
      .orderBy('p.name')
      .execute() as never;
  }

  /**
   * Apply an inventory movement atomically:
   *  - Upserts the inventory row
   *  - Updates quantity_on_hand (+delta)
   *  - Maintains weighted_avg_cost on positive deltas
   *  - Writes an inventory_movements audit row
   *
   * Negative deltas require sufficient stock or the transaction aborts,
   * which guarantees we never go below zero (also enforced by CHECK).
   */
  async applyMovement(
    trx: Transaction<DB>,
    params: {
      product_id: string;
      delta: number;
      reason: InventoryMovementReason;
      unit_cost?: string | number | null;
      invoice_id?: string | null;
      actor_user_id?: string | null;
      notes?: string | null;
    },
  ): Promise<void> {
    if (params.delta === 0) return;

    const existing = await trx
      .selectFrom('inventory')
      .select(['quantity_on_hand', 'weighted_avg_cost'])
      .where('product_id', '=', params.product_id)
      .executeTakeFirst();

    const current = existing?.quantity_on_hand ?? 0;
    const next = current + params.delta;
    if (next < 0) {
      throw new BadRequestException(
        `Insufficient stock for product ${params.product_id}: have ${current}, needed ${-params.delta}`,
      );
    }

    // Weighted-average cost update (only on positive, cost-bearing movements).
    let newWac: string | null = null;
    if (params.delta > 0 && params.unit_cost !== undefined && params.unit_cost !== null) {
      const prevWac = d(existing?.weighted_avg_cost ?? 0);
      const prevTotal = prevWac.times(current);
      const newTotal = prevTotal.plus(d(params.unit_cost).times(params.delta));
      newWac = toDbString(next > 0 ? newTotal.div(next) : 0);
    }

    if (existing) {
      await trx
        .updateTable('inventory')
        .set({
          quantity_on_hand: next,
          ...(newWac !== null && { weighted_avg_cost: newWac }),
          ...(params.delta > 0 &&
            params.unit_cost !== undefined &&
            params.unit_cost !== null && {
              last_purchase_price: toDbString(params.unit_cost),
            }),
        })
        .where('product_id', '=', params.product_id)
        .execute();
    } else {
      await trx
        .insertInto('inventory')
        .values({
          product_id: params.product_id,
          quantity_on_hand: next,
          weighted_avg_cost:
            params.unit_cost !== undefined && params.unit_cost !== null
              ? toDbString(params.unit_cost)
              : '0',
          last_purchase_price:
            params.unit_cost !== undefined && params.unit_cost !== null
              ? toDbString(params.unit_cost)
              : null,
        })
        .execute();
    }

    await trx
      .insertInto('inventory_movements')
      .values({
        product_id: params.product_id,
        delta: params.delta,
        reason: params.reason,
        invoice_id: params.invoice_id ?? null,
        unit_cost:
          params.unit_cost !== undefined && params.unit_cost !== null
            ? toDbString(params.unit_cost)
            : null,
        notes: params.notes ?? null,
        actor_user_id: params.actor_user_id ?? null,
      })
      .execute();
  }

  /** Manual adjustment by an admin. Uses its own transaction. */
  async adjust(
    productId: string,
    delta: number,
    actorUserId: string,
    notes?: string,
  ): Promise<InventoryRow> {
    const product = await this.db
      .selectFrom('products')
      .select('id')
      .where('id', '=', productId)
      .executeTakeFirst();
    if (!product) throw new NotFoundException('Product not found');

    await this.db.transaction().execute((trx) =>
      this.applyMovement(trx, {
        product_id: productId,
        delta,
        reason: 'adjustment',
        actor_user_id: actorUserId,
        notes,
      }),
    );

    const rows = await this.list();
    const row = rows.find((r) => r.product_id === productId);
    if (!row) throw new NotFoundException();
    return row;
  }
}
