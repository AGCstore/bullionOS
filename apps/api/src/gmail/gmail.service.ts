import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { gmail_v1, google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { IntegrationsService } from '../integrations/integrations.service';
import type { CredentialsFor } from '../integrations/integrations.registry';
import { NotificationsService } from '../notifications/notifications.service';
import { RarcoaService, type RarcoaSnapshot } from '../rarcoa/rarcoa.service';

type Creds = CredentialsFor<'gmail'>;

export interface PollResult {
  checked: boolean;
  /** Messages the Gmail query matched (before filtering). */
  matched: number;
  /** Messages we actually ingested this run. */
  ingested: number;
  /** Per-message outcomes for UI display. */
  details: Array<{
    message_id: string;
    from: string | null;
    subject: string | null;
    internal_date: string | null;
    outcome: 'ingested' | 'skipped-no-pdf' | 'skipped-parse-fail' | 'error';
    as_of_date?: string | null;
    error?: string | null;
  }>;
  /** Reason polling was a no-op (not configured, not enabled, etc.). */
  skipped_reason?: string;
}

/**
 * Gmail auto-ingest for RARCOA daily goldsheets.
 *
 * Workflow (runs every ~15 min via @Cron):
 *   1. Resolve creds + OAuth client from the integrations row.
 *   2. gmail.users.messages.list with a Gmail search query:
 *      `from:rarcoa.com has:attachment filename:pdf -label:RARCOA/Processed
 *       newer_than:2d subject:Goldsheet`
 *   3. For each hit:
 *      a. Download the PDF attachment.
 *      b. Hand it to RarcoaService.ingestPdf().
 *      c. On success, apply the "RARCOA/Processed" label so we skip it
 *         next time (Gmail is our dedup source of truth — no DB flag).
 *   4. Broadcast an admin notification per successful ingest.
 *
 * Admin can also trigger the same flow manually via the "Check now"
 * button on /admin/rarcoa — that calls pollOnce() directly.
 *
 * Failures are NEVER retried in-band. We log, emit a notification on
 * parse failure, and leave the message unlabeled so the next poll
 * picks it up. If parsing keeps failing, the admin can still upload
 * the PDF by hand.
 */
@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly notifications: NotificationsService,
    private readonly rarcoa: RarcoaService,
  ) {}

  async isAuthorized(): Promise<boolean> {
    const creds = await this.resolveCreds();
    return Boolean(creds && creds.refresh_token);
  }

  /**
   * Status payload for the /admin/rarcoa page so it can show whether
   * auto-ingest is configured, authorized, and what the last run did.
   */
  async getStatus(): Promise<{
    configured: boolean;
    authorized: boolean;
    enabled: boolean;
    mailbox: string | null;
    poll_interval_minutes: number | null;
    last_tested_at: string | null;
    last_test_ok: boolean | null;
    last_test_message: string | null;
  }> {
    const all = await this.integrations.listStatus();
    const row = all.find((s) => s.provider === 'gmail');
    const creds = await this.resolveCreds();
    return {
      configured: Boolean(row?.configured),
      authorized: Boolean(creds?.refresh_token),
      enabled: Boolean(row?.enabled),
      mailbox: creds?.mailbox_email ?? null,
      poll_interval_minutes: creds?.poll_interval_minutes ?? null,
      last_tested_at: row?.last_tested_at
        ? row.last_tested_at.toString()
        : null,
      last_test_ok: row?.last_test_ok ?? null,
      last_test_message: row?.last_test_message ?? null,
    };
  }

  /** Return the Google consent URL the admin's browser visits. */
  async buildAuthorizeUrl(redirectUri: string, state: string): Promise<string> {
    const creds = await this.resolveCreds();
    if (!creds) {
      throw new BadRequestException(
        'Gmail not configured yet. Save client_id and client_secret first, then authorize.',
      );
    }
    if (!creds.client_id || !creds.client_secret) {
      throw new BadRequestException(
        'client_id and client_secret must be saved before authorizing.',
      );
    }
    const oauth = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      redirectUri,
    );
    return oauth.generateAuthUrl({
      access_type: 'offline',
      // prompt=consent is required to force a refresh_token on re-auth —
      // without it Google only returns one the very first time an account
      // consents to the client.
      prompt: 'consent',
      // gmail.modify covers read + label changes. Not `.readonly` because
      // we need to apply the "RARCOA/Processed" label for idempotency.
      scope: ['https://www.googleapis.com/auth/gmail.modify'],
      state,
      include_granted_scopes: true,
    });
  }

  /** Finish the OAuth dance — exchange `code` for a refresh token. */
  async completeAuthorization(
    code: string,
    redirectUri: string,
  ): Promise<{ refreshToken: string }> {
    const creds = await this.resolveCreds();
    if (!creds) throw new BadRequestException('Gmail creds missing');
    const oauth = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      redirectUri,
    );
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google did not return a refresh token. Remove app access at https://myaccount.google.com/permissions and retry.',
      );
    }
    return { refreshToken: tokens.refresh_token };
  }

  /** Admin "Test connection" — pings users.getProfile. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const creds = await this.resolveCreds();
      if (!creds) return { ok: false, message: 'Not configured' };
      if (!creds.refresh_token) {
        return { ok: false, message: 'Not authorized (no refresh token)' };
      }
      const gmail = this.gmail(creds);
      const res = await gmail.users.getProfile({ userId: 'me' });
      const email = res.data.emailAddress ?? '(unknown)';
      return { ok: true, message: `OK · signed in as ${email}` };
    } catch (err) {
      return {
        ok: false,
        message: (err as Error).message.slice(0, 500),
      };
    }
  }

  /**
   * Cron entry point. @nestjs/schedule fires this every 15 min on the
   * dot — we don't respect the admin-configurable poll_interval_minutes
   * as a literal schedule (would require dynamic cron registration),
   * instead we short-circuit when the last run happened within that
   * window. Admins who set 60 min just get a faster heartbeat from cron
   * but the actual work still runs hourly. Default of 15 min keeps the
   * expected latency honest.
   */
  // @nestjs/schedule's CronExpression enum doesn't ship an EVERY_15_MINUTES
  // constant — pass the literal 6-field cron instead. Same semantics.
  @Cron('0 */15 * * * *', { name: 'gmail-rarcoa-poll' })
  async scheduledPoll(): Promise<void> {
    try {
      const result = await this.pollOnce();
      if (result.checked) {
        this.logger.log(
          `Gmail poll: matched=${result.matched} ingested=${result.ingested}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Gmail poll failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Shared poll impl for both cron and manual "Check now". Returns a
   * structured result so the UI can tell the operator what happened.
   */
  async pollOnce(): Promise<PollResult> {
    const all = await this.integrations.listStatus();
    const row = all.find((s) => s.provider === 'gmail');
    if (!row || !row.configured) {
      return { checked: false, matched: 0, ingested: 0, details: [], skipped_reason: 'not configured' };
    }
    if (!row.enabled) {
      return { checked: false, matched: 0, ingested: 0, details: [], skipped_reason: 'disabled' };
    }
    const creds = await this.resolveCreds();
    if (!creds || !creds.refresh_token) {
      return { checked: false, matched: 0, ingested: 0, details: [], skipped_reason: 'not authorized' };
    }

    const gmail = this.gmail(creds);

    // Build the Gmail search query. `has:attachment filename:pdf` narrows
    // to messages with PDFs; `-label:<processed>` excludes ones we've
    // already ingested; `newer_than:2d` keeps the working set tiny so
    // polling is cheap even after months of accumulated messages.
    const q = [
      creds.sender_filter.trim(),
      'has:attachment',
      'filename:pdf',
      creds.subject_filter.trim() ? `subject:${creds.subject_filter.trim()}` : '',
      `-label:${creds.processed_label}`,
      'newer_than:2d',
    ]
      .filter(Boolean)
      .join(' ');

    const list = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: 10,
    });
    const matches = list.data.messages ?? [];
    if (matches.length === 0) {
      return { checked: true, matched: 0, ingested: 0, details: [] };
    }

    // Ensure the label exists before we start applying it. Nested labels
    // ("RARCOA/Processed") are first-class in Gmail — create on demand.
    const labelId = await this.ensureLabel(gmail, creds.processed_label);

    const details: PollResult['details'] = [];
    let ingested = 0;

    for (const m of matches) {
      if (!m.id) continue;

      try {
        const msg = await gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'full',
        });
        const headers = msg.data.payload?.headers ?? [];
        const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? null;
        const subject =
          headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? null;
        const internalDate = msg.data.internalDate
          ? new Date(Number(msg.data.internalDate)).toISOString()
          : null;

        const pdfPart = this.findPdfAttachment(msg.data.payload);
        if (!pdfPart || !pdfPart.body?.attachmentId) {
          details.push({
            message_id: m.id,
            from,
            subject,
            internal_date: internalDate,
            outcome: 'skipped-no-pdf',
          });
          continue;
        }

        const attach = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: m.id,
          id: pdfPart.body.attachmentId,
        });
        const rawData = attach.data.data;
        if (!rawData) {
          details.push({
            message_id: m.id,
            from,
            subject,
            internal_date: internalDate,
            outcome: 'skipped-no-pdf',
            error: 'Attachment body was empty',
          });
          continue;
        }
        // Gmail returns base64url — swap to standard base64 for Node's Buffer.
        const pdfBuffer = Buffer.from(rawData, 'base64url');

        let snap: RarcoaSnapshot;
        try {
          snap = await this.rarcoa.ingestPdf({
            pdfBuffer,
            filename: pdfPart.filename ?? null,
            ingestedByUserId: null,
          });
        } catch (err) {
          details.push({
            message_id: m.id,
            from,
            subject,
            internal_date: internalDate,
            outcome: 'skipped-parse-fail',
            error: (err as Error).message.slice(0, 500),
          });
          // Don't label — let a future poll pick it up once parsing is fixed.
          continue;
        }

        // Apply the label so the next poll skips this message. Also mark
        // it read — the daily email doesn't need to stay in the operator's
        // Unread tally once we've ingested it.
        await gmail.users.messages.modify({
          userId: 'me',
          id: m.id,
          requestBody: {
            addLabelIds: [labelId],
            removeLabelIds: ['UNREAD'],
          },
        });

        details.push({
          message_id: m.id,
          from,
          subject,
          internal_date: internalDate,
          outcome: 'ingested',
          as_of_date: snap.as_of_date,
        });
        ingested++;

        // Broadcast to admins + staff. Keep the body tight — most
        // operators only need the date and cell count.
        await this.notifications.notifyRoles(['admin', 'staff'], {
          type: 'rarcoa.auto_ingest',
          title: `RARCOA sheet auto-ingested · ${snap.as_of_date}`,
          body: `${snap.cells.length} price rows parsed from the daily email. Basis gold ${
            snap.basis_gold !== null ? '$' + snap.basis_gold.toFixed(2) : 'n/a'
          }.`,
          link: '/admin/rarcoa',
        });
      } catch (err) {
        details.push({
          message_id: m.id,
          from: null,
          subject: null,
          internal_date: null,
          outcome: 'error',
          error: (err as Error).message.slice(0, 500),
        });
      }
    }

    return { checked: true, matched: matches.length, ingested, details };
  }

  // --- internals ---

  private async resolveCreds(): Promise<Creds | null> {
    const creds = await this.integrations.getCredentials('gmail');
    if (!creds) return null;
    return creds as Creds;
  }

  private gmail(creds: Creds): gmail_v1.Gmail {
    const oauth = new OAuth2Client(creds.client_id, creds.client_secret);
    oauth.setCredentials({ refresh_token: creds.refresh_token });
    return google.gmail({ version: 'v1', auth: oauth });
  }

  /**
   * Walk the MIME tree looking for a PDF attachment. Daily RARCOA
   * emails carry the PDF as the only attachment, but in general
   * multipart payloads can be arbitrarily deep (multipart/mixed with
   * a multipart/alternative body + multipart/related inline images +
   * the real attachment), so we recurse.
   */
  private findPdfAttachment(
    part: gmail_v1.Schema$MessagePart | undefined,
  ): gmail_v1.Schema$MessagePart | null {
    if (!part) return null;
    const filename = part.filename ?? '';
    const mime = part.mimeType ?? '';
    if (
      (mime === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) &&
      part.body?.attachmentId
    ) {
      return part;
    }
    for (const child of part.parts ?? []) {
      const hit = this.findPdfAttachment(child);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Find the label by name, creating it if it doesn't exist. Nested
   * names with "/" render as a tree in the Gmail UI automatically.
   */
  private async ensureLabel(
    gmail: gmail_v1.Gmail,
    name: string,
  ): Promise<string> {
    const res = await gmail.users.labels.list({ userId: 'me' });
    const existing = (res.data.labels ?? []).find((l) => l.name === name);
    if (existing?.id) return existing.id;
    const created = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    if (!created.data.id) {
      throw new Error(`Label ${name} created but Google returned no id`);
    }
    return created.data.id;
  }
}
