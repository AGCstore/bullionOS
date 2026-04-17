import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';

export interface BrandingSettings {
  company_name: string;
  company_tagline: string;
  address_line1: string;
  address_line2: string;
  address_city_state_zip: string;
  phone: string;
  website: string;
  /** True when a logo has been uploaded, false otherwise. */
  has_logo: boolean;
  /** Public URL the web UI can render. */
  logo_url: string | null;
  has_favicon: boolean;
  favicon_url: string | null;
}

/**
 * Branding + settings store, backed entirely by Postgres.
 *
 * Text settings live in `app_settings` (JSONB values keyed by dotted name).
 * Binary assets (logo, favicon) live in `branding_assets` as BYTEA so they
 * survive Railway deploys — the ephemeral container filesystem can't hold
 * user-uploaded files reliably. No disk touch anywhere in this service.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom('app_settings').selectAll().execute();
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async getBranding(): Promise<BrandingSettings> {
    const [all, assets] = await Promise.all([
      this.getAll(),
      this.db
        .selectFrom('branding_assets')
        .select(['slug'])
        .execute(),
    ]);
    const slugs = new Set(assets.map((a) => a.slug));
    return {
      company_name: (all['branding.company_name'] as string) ?? 'Atlanta Gold and Coin',
      company_tagline: (all['branding.company_tagline'] as string) ?? '',
      address_line1:
        (all['branding.address_line1'] as string) ?? '8480 Holcomb Bridge Rd #200',
      address_line2: (all['branding.address_line2'] as string) ?? '',
      address_city_state_zip:
        (all['branding.address_city_state_zip'] as string) ?? 'Alpharetta, GA 30022',
      phone: (all['branding.phone'] as string) ?? '404-236-9744',
      website: (all['branding.website'] as string) ?? 'atlantagoldandcoin.com',
      has_logo: slugs.has('logo'),
      logo_url: slugs.has('logo') ? '/api/v1/public/branding/logo' : null,
      has_favicon: slugs.has('favicon'),
      favicon_url: slugs.has('favicon') ? '/api/v1/public/branding/favicon' : null,
    };
  }

  async setString(key: string, value: string, actorId: string | null = null): Promise<void> {
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

  /**
   * Upsert a branding asset (logo, favicon, …) as raw bytes. Replaces any
   * prior asset for the same slug. Bytes go directly into bytea — Postgres
   * stores them TOASTed when large, which keeps the main row slim.
   */
  async setAsset(
    slug: 'logo' | 'favicon',
    mime: string,
    bytes: Buffer,
    actorId: string | null = null,
  ): Promise<void> {
    await this.db
      .insertInto('branding_assets')
      .values({ slug, mime, bytes, updated_by_user_id: actorId })
      .onConflict((oc) =>
        oc.column('slug').doUpdateSet({
          mime,
          bytes,
          updated_by_user_id: actorId,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  async getAsset(
    slug: 'logo' | 'favicon',
  ): Promise<{ mime: string; bytes: Buffer; updatedAt: Date } | null> {
    const row = await this.db
      .selectFrom('branding_assets')
      .select(['mime', 'bytes', 'updated_at'])
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!row) return null;
    // pg returns bytea as Buffer already, but cast defensively.
    return {
      mime: row.mime,
      bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes as never),
      updatedAt: new Date(row.updated_at as unknown as string),
    };
  }

  async deleteAsset(slug: 'logo' | 'favicon'): Promise<void> {
    await this.db.deleteFrom('branding_assets').where('slug', '=', slug).execute();
  }
}
