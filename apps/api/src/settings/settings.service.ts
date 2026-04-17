import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';

export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

export interface BrandingSettings {
  company_name: string;
  company_tagline: string;
  /** Street address block — free-form, rendered verbatim on PDFs. */
  address_line1: string;
  address_line2: string;
  address_city_state_zip: string;
  phone: string;
  website: string;
  /** Absolute path on disk to the logo file, or null if not set. */
  logo_path: string | null;
  /** Public URL the web UI can render. */
  logo_url: string | null;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async ensureUploadsDir(): Promise<void> {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  }

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.db.selectFrom('app_settings').selectAll().execute();
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async getBranding(): Promise<BrandingSettings> {
    const all = await this.getAll();
    const logoPath = (all['branding.logo_path'] as string | null) ?? null;
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
      logo_path: logoPath,
      logo_url: logoPath ? `/api/v1/public/branding/logo` : null,
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

  async setLogoPath(diskPath: string | null, actorId: string | null = null): Promise<void> {
    await this.db
      .insertInto('app_settings')
      .values({
        key: 'branding.logo_path',
        value: sql`${JSON.stringify(diskPath)}::jsonb`,
        updated_by_user_id: actorId,
      })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: sql`${JSON.stringify(diskPath)}::jsonb`,
          updated_by_user_id: actorId,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  /** Resolve the current logo to a disk path, or null if not set / missing. */
  async resolveLogoFile(): Promise<string | null> {
    const branding = await this.getBranding();
    if (!branding.logo_path) return null;
    try {
      await fs.access(branding.logo_path);
      return branding.logo_path;
    } catch {
      // Config drift: DB says logo exists but file is gone. Don't crash.
      this.logger.warn(`Logo path ${branding.logo_path} missing on disk`);
      return null;
    }
  }

  async deleteLogo(actorId: string | null = null): Promise<void> {
    const current = await this.resolveLogoFile();
    if (current) {
      try {
        await fs.unlink(current);
      } catch {
        /* ignore — file might already be gone */
      }
    }
    await this.setLogoPath(null, actorId);
  }
}
