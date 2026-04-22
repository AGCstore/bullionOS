import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB } from '../db/types';
import { EmailService } from '../email/email.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Back-in-stock notification dispatcher.
 *
 * Drains pending rows from `restock_subscriptions` (migration 029) when a
 * product's `available = on_hand - reserved` goes from ≤ 0 to > 0. Each
 * subscriber gets at most ONE email per (product, email) pair — the first
 * fire stamps `notified_at` so a later inventory wiggle (sold out, then
 * restocked again) doesn't double-email the same person. A fresh signup
 * after notification lives in a new row via the (product_id, email)
 * UPSERT in InventoryController, so a genuinely new "notify me" gets
 * its own email.
 *
 * Dispatch is best-effort: callers invoke {@link dispatchForProducts}
 * AFTER their inventory transaction commits. Failures here never roll
 * back the stock movement that triggered them — the subscribers stay
 * pending and the next qualifying movement will try again.
 *
 * Idempotence: dispatching for a product whose `available` is still > 0
 * but has no pending subscribers is a no-op (the SELECT returns empty).
 * Dispatching while `available` is back ≤ 0 also no-ops — we re-check
 * current stock before firing to avoid emailing "back in stock!" for
 * something that flipped out of stock again between commit and dispatch.
 */
@Injectable()
export class RestockService {
  private readonly logger = new Logger(RestockService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Dispatch notifications for a batch of product ids. Deduplicates
   * ids (a single invoice finalize can mention the same product on
   * multiple line items) and swallows per-product failures so one
   * rogue product doesn't block the rest. Call this AFTER the parent
   * trx commits.
   */
  async dispatchForProducts(productIds: string[]): Promise<void> {
    if (productIds.length === 0) return;
    const unique = [...new Set(productIds.filter(Boolean))];
    for (const pid of unique) {
      try {
        await this.dispatchForProduct(pid);
      } catch (err) {
        this.logger.error(
          `restock dispatch failed for ${pid}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Send the "back in stock" email to every pending subscriber for
   * `productId`, then stamp notified_at. No-op if the product isn't
   * currently publicly visible + in stock, or if there are no pending
   * rows.
   */
  async dispatchForProduct(productId: string): Promise<void> {
    // Confirm current state: product still active + public + actually
    // available. Handles the race where stock went 0→+→0 between the
    // trigger movement and this dispatch.
    const product = await this.db
      .selectFrom('products as p')
      .leftJoin('inventory as inv', 'inv.product_id', 'p.id')
      .select([
        'p.id',
        'p.sku',
        'p.name',
        'p.is_active',
        'p.show_on_website',
        sql<number>`COALESCE(inv.quantity_on_hand, 0) - COALESCE(inv.quantity_reserved, 0)`.as(
          'available',
        ),
      ])
      .where('p.id', '=', productId)
      .executeTakeFirst();

    if (
      !product ||
      !product.is_active ||
      !product.show_on_website ||
      product.available <= 0
    ) {
      return;
    }

    const pending = await this.db
      .selectFrom('restock_subscriptions')
      .select(['id', 'email', 'token'])
      .where('product_id', '=', productId)
      .where('notified_at', 'is', null)
      .execute();

    if (pending.length === 0) return;

    const [branding, tpl] = await Promise.all([
      this.settings.getBranding(),
      this.settings.getEmailTemplate('restock_back_in_stock'),
    ]);

    const defaultSubject =
      '{{product_name}} is back in stock at {{company_name}}';
    const defaultBody =
      'Hi,\n\n' +
      '{{product_name}} is back in stock at {{company_name}}. You signed up to be notified when it returned.\n\n' +
      'Shop now: {{shop_url}}\n\n' +
      'Quantities can move fast — first-come, first-served.\n\n' +
      '— {{company_name}}\n' +
      '{{company_phone}}\n\n' +
      'No longer interested? Unsubscribe: {{unsubscribe_url}}';

    const apiBase = (
      this.config.get<string>('API_BASE_URL') ?? ''
    ).replace(/\/+$/, '');
    const shopUrl = this.absoluteWebsiteUrl(branding.website);

    for (const sub of pending) {
      const vars = {
        product_name: product.name,
        product_sku: product.sku,
        shop_url: shopUrl,
        unsubscribe_url: `${apiBase}/api/v1/public/restock-unsubscribe/${sub.token}`,
        company_name: branding.company_name,
        company_phone: branding.phone,
      };
      const subject = this.settings.renderEmailTemplate(
        tpl.subject ?? defaultSubject,
        vars,
      );
      const body = this.settings.renderEmailTemplate(
        tpl.body ?? defaultBody,
        vars,
      );

      // EmailService.send() never throws (catches + logs internally).
      // We still stamp notified_at either way — if SMTP is down we
      // don't want to spam the subscriber with retries on every
      // future movement. The operator will see the send failure in
      // logs and can manually resend from the admin product detail
      // page (future work).
      await this.email.send({ to: sub.email, subject, text: body });
      await this.db
        .updateTable('restock_subscriptions')
        .set({ notified_at: new Date() })
        .where('id', '=', sub.id)
        .execute();
    }

    this.logger.log(
      `restock: notified ${pending.length} subscriber${
        pending.length === 1 ? '' : 's'
      } for ${product.sku} (${product.name})`,
    );
  }

  /**
   * One-click unsubscribe. Tokens are 128-bit hex (randomUUID-derived)
   * so guessing is not a concern. Deletes the row outright — if the
   * same email later wants notifications again they re-sign up from
   * the widget.
   *
   * Returns the product name (or null if token didn't match anything)
   * so the confirmation page can show "you won't hear from us about
   * X" instead of a generic message.
   */
  async unsubscribe(token: string): Promise<{ productName: string | null }> {
    if (!token || token.length < 8 || token.length > 64) {
      return { productName: null };
    }
    const row = await this.db
      .selectFrom('restock_subscriptions as rs')
      .leftJoin('products as p', 'p.id', 'rs.product_id')
      .select(['rs.id', 'p.name'])
      .where('rs.token', '=', token)
      .executeTakeFirst();
    if (!row) return { productName: null };
    await this.db
      .deleteFrom('restock_subscriptions')
      .where('id', '=', row.id)
      .execute();
    return { productName: row.name ?? null };
  }

  /**
   * Branding website is stored as "atlantagoldandcoin.com" (naked
   * domain). Make it a clickable absolute URL for the email body and
   * the unsubscribe confirmation page.
   */
  private absoluteWebsiteUrl(website: string): string {
    if (!website) return '';
    if (/^https?:\/\//i.test(website)) return website;
    return `https://${website}`;
  }
}
