import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { SettingsService } from '../settings/settings.service';
import { RestockService } from './restock.service';

/**
 * Public routes for the back-in-stock notification flow. The signup
 * endpoint lives next to the inventory feed in InventoryController
 * (POST /public/restock-notify) because it needs the same "is this
 * product in the public shop?" validation. The unsubscribe endpoint
 * lives here because it's the pair to the notification sender and
 * doesn't touch inventory.
 *
 * No auth. The token in the URL IS the auth — 128-bit random from
 * randomUUID() when the subscription was created, unguessable. Hitting
 * the URL deletes the row outright; one-click unsubscribe per CAN-SPAM
 * norms.
 */
@Controller()
export class RestockController {
  constructor(
    private readonly restock: RestockService,
    private readonly settings: SettingsService,
  ) {}

  @Public()
  @Get('public/restock-unsubscribe/:token')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Param('token') token: string, @Res() res: Response) {
    const [result, branding] = await Promise.all([
      this.restock.unsubscribe(token),
      this.settings.getBranding(),
    ]);

    const companyName = escapeHtml(branding.company_name);
    const shopHost = branding.website
      ? /^https?:\/\//i.test(branding.website)
        ? branding.website
        : `https://${branding.website}`
      : '';
    const shopLink = shopHost
      ? `<a href="${escapeHtml(shopHost)}">${escapeHtml(
          branding.website || companyName,
        )}</a>`
      : companyName;

    const bodyCopy = result.productName
      ? `You'll no longer receive back-in-stock notifications for <strong>${escapeHtml(
          result.productName,
        )}</strong>.`
      : // Unknown/expired token — don't leak which of "wrong URL" or
        // "already unsubscribed" it is; just confirm they're off the list.
        `You're not on our back-in-stock list. No further action needed.`;

    res.status(200).send(renderUnsubscribeHtml({ bodyCopy, shopLink, companyName }));
  }
}

/** Minimal inline HTML — no framework; page serves once and is done. */
function renderUnsubscribeHtml(v: {
  bodyCopy: string;
  shopLink: string;
  companyName: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Unsubscribed — ${v.companyName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
           background: #f7f7f6; margin: 0; padding: 48px 24px; color: #1a1a1a; }
    .card { max-width: 520px; margin: 0 auto; background: #fff;
            border: 1px solid #e5e5e4; border-radius: 12px; padding: 32px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    h1 { font-size: 22px; margin: 0 0 16px; letter-spacing: -0.01em; }
    p { line-height: 1.55; margin: 0 0 14px; color: #303030; }
    a { color: #8a6d1e; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .brand { margin-top: 24px; font-size: 13px; color: #7a7a77; }
  </style>
</head>
<body>
  <div class="card">
    <h1>You've been unsubscribed.</h1>
    <p>${v.bodyCopy}</p>
    <p>Changed your mind? Visit ${v.shopLink} anytime and sign up again.</p>
    <p class="brand">— ${v.companyName}</p>
  </div>
</body>
</html>`;
}

/** HTML escape for product names + branding fields rendered into inline HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
