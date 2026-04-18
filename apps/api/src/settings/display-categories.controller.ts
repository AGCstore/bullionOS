import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import type { DB } from '../db/types';

/**
 * Admin-controlled display-category metadata.
 *
 * Two pieces of state live under `app_settings`:
 *
 *   - key `display_categories.custom` (JSONB array): user-added
 *     categories beyond the 12 builtins. Shape:
 *       [{ id: 'foo', label: 'Foo', metal: 'gold' }, ...]
 *
 *   - key `display_categories.order` (JSONB array): operator-preferred
 *     ordering for the full merged list (builtins + custom). The id
 *     sequence is what the frontend renders top-to-bottom; ids not in
 *     the list fall back to the builtin default order at the end.
 *
 * Builtins are NOT persisted — the frontend ships the 12 defaults
 * compiled in and merges with this API's output. That keeps admins from
 * accidentally destroying a builtin they rely on and lets us upgrade
 * the default taxonomy on any deploy without a data migration.
 */

const CUSTOM_KEY = 'display_categories.custom';
const ORDER_KEY = 'display_categories.order';

const METALS = ['gold', 'silver', 'platinum', 'palladium', 'other'] as const;

// Slug format lines up with the frontend's builtin IDs: lowercase snake.
const SLUG_RE = /^[a-z][a-z0-9_]*$/;

class AddCustomCategoryDto {
  @IsString() @MinLength(2) @MaxLength(40) @Matches(SLUG_RE, {
    message: 'id must be lowercase snake_case (letters/digits/underscore)',
  })
  id!: string;

  @IsString() @MinLength(1) @MaxLength(80)
  label!: string;

  @IsIn(METALS)
  metal!: (typeof METALS)[number];
}

class OrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  order!: string[];
}

interface CustomCategory {
  id: string;
  label: string;
  metal: (typeof METALS)[number];
}

@Controller('admin/display-categories')
@Roles('admin', 'staff')
export class DisplayCategoriesController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /**
   * Return both custom categories and the preferred order in one call —
   * the admin UI needs both and keeping them in lock-step avoids a
   * flicker where the new row appears before the saved order lands.
   */
  @Get()
  async list() {
    const [custom, order] = await Promise.all([
      this.readCustom(),
      this.readOrder(),
    ]);
    return { custom, order };
  }

  @Put('order')
  @HttpCode(204)
  async setOrder(@Body() dto: OrderDto, @CurrentUser() user: RequestUser) {
    await this.write(ORDER_KEY, dto.order, user.id);
  }

  @Put('custom')
  async addCustom(
    @Body() dto: AddCustomCategoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    const existing = await this.readCustom();
    if (existing.some((c) => c.id === dto.id)) {
      throw new BadRequestException(`Custom category "${dto.id}" already exists`);
    }
    // Guard against clobbering a builtin slug — the frontend's builtins
    // are the source of truth for those IDs and we don't want the
    // custom row to shadow them.
    if (BUILTIN_SLUGS.has(dto.id)) {
      throw new BadRequestException(
        `"${dto.id}" is a builtin category slug; pick a different id`,
      );
    }
    const next = [...existing, { id: dto.id, label: dto.label, metal: dto.metal }];
    await this.write(CUSTOM_KEY, next, user.id);
    return { custom: next };
  }

  @Delete('custom/:id')
  @HttpCode(204)
  async removeCustom(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const existing = await this.readCustom();
    const next = existing.filter((c) => c.id !== id);
    if (next.length === existing.length) {
      // Idempotent: deleting a nonexistent custom category returns 204
      // so the admin UI can fire-and-forget without a second fetch.
      return;
    }
    await this.write(CUSTOM_KEY, next, user.id);
    // Unset any product that pointed at the now-deleted slug so those
    // products fall back to the heuristic instead of orphaning into
    // the bucket-of-deleted-slugs.
    await this.db
      .updateTable('products')
      .set({ display_category_override: null })
      .where('display_category_override', '=', id)
      .execute();
  }

  private async readCustom(): Promise<CustomCategory[]> {
    const row = await this.db
      .selectFrom('app_settings')
      .select(['value'])
      .where('key', '=', CUSTOM_KEY)
      .executeTakeFirst();
    if (!row) return [];
    const v = row.value as unknown;
    return Array.isArray(v) ? (v as CustomCategory[]) : [];
  }

  private async readOrder(): Promise<string[]> {
    const row = await this.db
      .selectFrom('app_settings')
      .select(['value'])
      .where('key', '=', ORDER_KEY)
      .executeTakeFirst();
    if (!row) return [];
    const v = row.value as unknown;
    return Array.isArray(v) ? (v as string[]).filter((s) => typeof s === 'string') : [];
  }

  private async write(key: string, value: unknown, actorId: string) {
    await this.db
      .insertInto('app_settings')
      .values({
        key,
        value: sql`${JSON.stringify(value)}::jsonb`,
        updated_by_user_id: actorId,
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: sql`${JSON.stringify(value)}::jsonb`,
          updated_by_user_id: actorId,
          updated_at: new Date(),
        }),
      )
      .execute();
  }
}

/**
 * Mirrors apps/web/src/lib/product-category.ts SECTIONS. Kept in sync
 * by convention — if a new builtin is added on the frontend, add its
 * slug here too. Used only to block admins from creating a custom
 * category whose id collides with a builtin.
 */
const BUILTIN_SLUGS = new Set([
  'gold_coins',
  'gold_bars',
  'pre_1933_gold',
  'silver_coins',
  'silver_junk',
  'silver_generic',
  'silver_mint_sets',
  'platinum_coins',
  'platinum_bars',
  'palladium_coins',
  'palladium_bars',
  'other',
]);

/** Also need a public read so the web client can hydrate without auth
 *  churn — keeps the display order consistent across logged-in and
 *  anonymous views (the WP plugin uses /public/in-stock which doesn't
 *  render categories, so no exposure there). */
@Controller('public/display-categories')
export class PublicDisplayCategoriesController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  @Public()
  @Get()
  async list() {
    const [customRow, orderRow] = await Promise.all([
      this.db
        .selectFrom('app_settings')
        .select(['value'])
        .where('key', '=', CUSTOM_KEY)
        .executeTakeFirst(),
      this.db
        .selectFrom('app_settings')
        .select(['value'])
        .where('key', '=', ORDER_KEY)
        .executeTakeFirst(),
    ]);
    const custom = Array.isArray(customRow?.value)
      ? (customRow!.value as CustomCategory[])
      : [];
    const order = Array.isArray(orderRow?.value)
      ? ((orderRow!.value as unknown[]).filter((s) => typeof s === 'string') as string[])
      : [];
    return { custom, order };
  }
}
