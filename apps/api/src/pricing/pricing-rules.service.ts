import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, PricingRule } from '../db/types';
import { toDbString } from '../common/money';
import type { UpsertPricingRuleDto } from './dto/upsert-pricing-rule.dto';

@Injectable()
export class PricingRulesService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  list(): Promise<PricingRule[]> {
    return this.db
      .selectFrom('pricing_rules')
      .selectAll()
      .orderBy('scope')
      .orderBy('metal')
      .execute();
  }

  /**
   * Upsert a rule. Only one rule can be active per (scope+key) at a time,
   * so we deactivate the previous active rule inside a transaction before
   * inserting the new one, keeping full history in the table.
   */
  async upsert(dto: UpsertPricingRuleDto): Promise<PricingRule> {
    if (dto.scope === 'metal' && !dto.metal) {
      throw new BadRequestException('metal is required when scope=metal');
    }
    if (dto.scope === 'product' && !dto.product_id) {
      throw new BadRequestException('product_id is required when scope=product');
    }

    return this.db.transaction().execute(async (trx) => {
      // Deactivate previous active rule for the same key.
      let deactivateQ = trx
        .updateTable('pricing_rules')
        .set({ is_active: false, effective_until: new Date() })
        .where('is_active', '=', true)
        .where('scope', '=', dto.scope);
      if (dto.scope === 'metal') {
        deactivateQ = deactivateQ.where('metal', '=', dto.metal!);
      } else {
        deactivateQ = deactivateQ.where('product_id', '=', dto.product_id!);
      }
      await deactivateQ.execute();

      return trx
        .insertInto('pricing_rules')
        .values({
          scope: dto.scope,
          metal: dto.scope === 'metal' ? dto.metal! : null,
          product_id: dto.scope === 'product' ? dto.product_id! : null,
          buy_premium_type: dto.buy_premium_type,
          buy_premium_value: toDbString(dto.buy_premium_value),
          sell_premium_type: dto.sell_premium_type,
          sell_premium_value: toDbString(dto.sell_premium_value),
          is_active: true,
          effective_until: dto.effective_until ? new Date(dto.effective_until) : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async deactivate(id: string): Promise<void> {
    const r = await this.db
      .updateTable('pricing_rules')
      .set({ is_active: false, effective_until: new Date() })
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw new NotFoundException('Rule not found');
  }
}
