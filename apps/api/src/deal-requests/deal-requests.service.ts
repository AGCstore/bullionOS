import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, DealRequest, DealRequestStatus } from '../db/types';
import { toDbString } from '../common/money';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateDealRequestDto } from './dto/create-deal-request.dto';

@Injectable()
export class DealRequestsService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Resolve the client record owned by the given user (clients.user_id = user.id).
   * Throws if the user has no linked client record — they're a walk-in staff user.
   */
  async resolveClientIdForUser(userId: string): Promise<string> {
    const row = await this.db
      .selectFrom('clients')
      .select('id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) throw new ForbiddenException('No client profile linked to this account');
    return row.id;
  }

  async createForClient(userId: string, dto: CreateDealRequestDto): Promise<DealRequest> {
    if (!dto.product_id && !dto.product_description) {
      throw new BadRequestException(
        'Either product_id or product_description is required',
      );
    }

    const clientId = await this.resolveClientIdForUser(userId);

    // If product_id given, sanity-check it exists & is active.
    if (dto.product_id) {
      const p = await this.db
        .selectFrom('products')
        .select('id')
        .where('id', '=', dto.product_id)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (!p) throw new BadRequestException('Product not found or inactive');
    }

    const created = await this.db
      .insertInto('deal_requests')
      .values({
        client_id: clientId,
        type: dto.type,
        product_id: dto.product_id ?? null,
        product_description: dto.product_description ?? null,
        metal: dto.metal ?? null,
        quantity: dto.quantity ?? null,
        estimated_weight_troy_oz:
          dto.estimated_weight_troy_oz !== undefined
            ? toDbString(dto.estimated_weight_troy_oz)
            : null,
        notes: dto.notes ?? null,
        status: 'pending',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Notify all staff/admin of the new request.
    await this.notifications.notifyRoles(['admin', 'staff'], {
      type: 'deal_request.created',
      title: `New ${dto.type} request`,
      body: dto.product_description ?? `${dto.quantity ?? '?'}× ${dto.metal ?? 'item'}`,
      link: `/admin/requests/${created.id}`,
      metadata: { deal_request_id: created.id, type: dto.type },
    });

    return created;
  }

  listForClient(userId: string, status?: DealRequestStatus): Promise<DealRequest[]> {
    return this.resolveClientIdForUser(userId).then((clientId) => {
      let q = this.db
        .selectFrom('deal_requests')
        .selectAll()
        .where('client_id', '=', clientId)
        .orderBy('created_at', 'desc');
      if (status) q = q.where('status', '=', status);
      return q.execute();
    });
  }

  listAll(status?: DealRequestStatus) {
    let q = this.db
      .selectFrom('deal_requests as dr')
      .innerJoin('clients as c', 'c.id', 'dr.client_id')
      .leftJoin('products as p', 'p.id', 'dr.product_id')
      .selectAll('dr')
      .select([
        sql<string>`c.first_name || ' ' || c.last_name`.as('client_name'),
        'c.email as client_email',
        'p.name as product_name',
        'p.sku as product_sku',
      ])
      .orderBy('dr.created_at', 'desc')
      .limit(500);
    if (status) q = q.where('dr.status', '=', status);
    return q.execute();
  }

  async getById(id: string) {
    const row = await this.db
      .selectFrom('deal_requests as dr')
      .innerJoin('clients as c', 'c.id', 'dr.client_id')
      .leftJoin('products as p', 'p.id', 'dr.product_id')
      .selectAll('dr')
      .select([
        sql<string>`c.first_name || ' ' || c.last_name`.as('client_name'),
        'c.email as client_email',
        'p.name as product_name',
        'p.sku as product_sku',
      ])
      .where('dr.id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  async respond(
    id: string,
    decision: 'accepted' | 'rejected',
    actorUserId: string,
    message?: string,
  ): Promise<DealRequest> {
    const current = await this.db
      .selectFrom('deal_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!current) throw new NotFoundException('Request not found');
    if (current.status !== 'pending') {
      throw new BadRequestException(`Cannot respond: status is ${current.status}`);
    }

    const updated = await this.db
      .updateTable('deal_requests')
      .set({
        status: decision,
        responded_by_user_id: actorUserId,
        responded_at: new Date(),
        response_message: message ?? null,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Notify the client (if they have a portal account).
    await this.notifications.notifyClient(current.client_id, {
      type: `deal_request.${decision}`,
      title: decision === 'accepted' ? 'Request accepted' : 'Request declined',
      body: message ?? null,
      link: `/dashboard/requests`,
      metadata: { deal_request_id: id },
    });

    return updated;
  }
}
