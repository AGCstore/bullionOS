import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../common/decorators/current-user.decorator';
import { IntegrationsService } from '../integrations/integrations.service';
import type { CredentialsFor } from '../integrations/integrations.registry';
import { GmailService } from './gmail.service';

/**
 * Gmail auto-ingest plumbing.
 *
 *   GET  /admin/integrations/gmail/status
 *        — status summary for the RARCOA page (configured/authorized/
 *          last run). Admin + staff so staff can see "why didn't the
 *          sheet auto-load?" without an admin round-trip.
 *   POST /admin/integrations/gmail/poll
 *        — "Check now" trigger. Runs the same code path as the cron,
 *          returns the detail list so the UI can show per-message
 *          outcomes.
 *   GET  /admin/integrations/gmail/authorize?return_to=…
 *        — kicks off OAuth consent. Returns { url, redirect_uri }.
 *   GET  /admin/integrations/gmail/callback?code=…&state=…
 *        — Google's redirect destination. Writes the refresh token
 *          onto the integration row. Marked @Public because it runs
 *          un-authenticated (redirect from Google).
 */
@Controller()
export class GmailController {
  // In-memory CSRF state store. OAuth consent round-trips in seconds,
  // so a process-local map with TTL is enough for one-admin-at-a-time.
  // Also carries the initiating admin's user_id so the callback — which
  // runs un-authenticated — can still attribute the credential write
  // in the audit log.
  private readonly pending = new Map<
    string,
    { redirectUri: string; expiresAt: number; actorUserId: string }
  >();

  constructor(
    private readonly gmail: GmailService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Get('admin/integrations/gmail/status')
  @Roles('admin', 'staff')
  status() {
    return this.gmail.getStatus();
  }

  @Post('admin/integrations/gmail/poll')
  @Roles('admin', 'staff')
  async pollNow() {
    return this.gmail.pollOnce();
  }

  @Get('admin/integrations/gmail/authorize')
  @Roles('admin')
  async authorize(
    @Req() req: Request,
    @CurrentUser() user: RequestUser,
    @Query('return_to') returnTo?: string,
  ) {
    const origin = deriveOrigin(req);
    const redirectUri = `${origin}/api/v1/admin/integrations/gmail/callback`;

    const state = randomBytes(24).toString('hex');
    this.sweep();
    this.pending.set(state, {
      redirectUri,
      expiresAt: Date.now() + 5 * 60 * 1000,
      actorUserId: user.id,
    });
    const encodedState = `${state}.${Buffer.from(returnTo ?? '/admin/integrations').toString('base64url')}`;
    const url = await this.gmail.buildAuthorizeUrl(redirectUri, encodedState);
    return { url, redirect_uri: redirectUri };
  }

  /**
   * OAuth callback. Google hits this directly via the registered
   * redirect URI, so we can't assume a JWT — the endpoint is marked
   * @Public. We still verify the `state` param we issued.
   */
  @Public()
  @Get('admin/integrations/gmail/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      this.sendHtml(
        res,
        `<h2>Google refused authorization</h2><p>${escapeHtml(error)}</p>
         <p><a href="/admin/integrations">← back to integrations</a></p>`,
      );
      return;
    }
    if (!code || !state) {
      this.sendHtml(res, `<h2>Missing code or state</h2>`, 400);
      return;
    }
    const [nonce, returnB64] = state.split('.');
    const pending = this.pending.get(nonce);
    this.pending.delete(nonce);
    if (!pending || pending.expiresAt < Date.now()) {
      this.sendHtml(
        res,
        `<h2>Authorization expired</h2>
         <p>Please restart the flow from /admin/integrations.</p>`,
        400,
      );
      return;
    }
    const decoded = returnB64
      ? Buffer.from(returnB64, 'base64url').toString('utf8')
      : '';
    const returnTo = safeReturnTo(decoded);

    try {
      const { refreshToken } = await this.gmail.completeAuthorization(
        code,
        pending.redirectUri,
      );

      // Merge refresh_token into the existing integration row so the
      // filters/mailbox/poll interval the admin saved stay intact.
      const current = (await this.integrations.getCredentials(
        'gmail',
      )) as CredentialsFor<'gmail'> | null;
      if (!current) {
        this.sendHtml(
          res,
          `<h2>Integration row disappeared</h2>
           <p>Save the gmail credentials first, then reauthorize.</p>`,
          400,
        );
        return;
      }
      await this.integrations.set(
        'gmail',
        { ...current, refresh_token: refreshToken },
        pending.actorUserId,
      );

      this.sendHtml(
        res,
        `<!doctype html><meta charset="utf-8">
         <title>Authorized</title>
         <script>location.replace(${JSON.stringify(returnTo)})</script>
         <p>Authorized — redirecting…</p>`,
      );
    } catch (err) {
      this.sendHtml(
        res,
        `<h2>Authorization failed</h2>
         <pre>${escapeHtml((err as Error).message)}</pre>
         <p><a href="/admin/integrations">← back to integrations</a></p>`,
        500,
      );
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.pending.entries()) {
      if (v.expiresAt < now) this.pending.delete(k);
    }
  }

  private sendHtml(res: Response, body: string, status = 200) {
    res.status(status);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(body);
  }
}

function deriveOrigin(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
  const host =
    (req.headers['x-forwarded-host'] as string) ?? (req.headers.host as string);
  return `${proto}://${host}`;
}

/**
 * Validate the post-authorize redirect. Accepts an absolute URL whose
 * host matches WEB_ORIGIN, or a relative path (/admin/...) resolved
 * against WEB_ORIGIN. Anything else falls back to WEB_ORIGIN's
 * /admin/integrations root so we never open-redirect.
 */
function safeReturnTo(raw: string): string {
  const webOrigin = (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
  const fallback = webOrigin ? `${webOrigin}/admin/integrations` : '/admin/integrations';

  if (!raw) return fallback;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (webOrigin && `${u.protocol}//${u.host}` === webOrigin) return raw;
    } catch {
      /* fallthrough to fallback */
    }
    return fallback;
  }

  if (raw.startsWith('/')) {
    return webOrigin ? `${webOrigin}${raw}` : fallback;
  }
  return fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
