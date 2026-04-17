import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, sql } from 'kysely';
import { KYSELY } from '../db/database.module';
import type { DB, Notification } from '../db/types';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';

export interface NotifyPayload {
  user_id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly webOrigin: string;

  /**
   * Notification types that warrant an SMS (plus an email, plus the in-app
   * row). Keep this narrow — SMS is noisy and costs money per send.
   */
  private static readonly SMS_TYPES = new Set<string>([
    'invoice.created',
    'shipment.created',
    'shipment.status',
    'deal_request.accepted',
    'deal_request.rejected',
  ]);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<DB>,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    config: ConfigService,
  ) {
    this.webOrigin = config.getOrThrow<string>('WEB_ORIGIN');
  }

  /**
   * Create a notification row AND send an email if the user has opted in.
   * Email failures are swallowed by EmailService — they must never block the
   * business action that triggered the notification.
   */
  async create(p: NotifyPayload): Promise<void> {
    await this.db
      .insertInto('notifications')
      .values({
        user_id: p.user_id,
        type: p.type,
        title: p.title,
        body: p.body ?? null,
        link: p.link ?? null,
        metadata: sql`${JSON.stringify(p.metadata ?? {})}::jsonb`,
      })
      .execute();

    // Fetch contact info + opt-in flags in a single round trip.
    const user = await this.db
      .selectFrom('users')
      .select([
        'email',
        'email_notifications',
        'phone_e164',
        'sms_notifications',
      ])
      .where('id', '=', p.user_id)
      .executeTakeFirst();
    if (!user) return;

    const link = p.link ? this.webOrigin + p.link : null;

    if (user.email_notifications) {
      const bodyLines = [p.body, link ? `\n${link}` : null].filter(Boolean);
      void this.email.send({
        to: user.email,
        subject: p.title,
        text: bodyLines.join('\n'),
        html: `<p>${escapeHtml(p.body ?? '')}</p>${
          link ? `<p><a href="${link}">${link}</a></p>` : ''
        }`,
      });
    }

    if (
      user.sms_notifications &&
      user.phone_e164 &&
      NotificationsService.SMS_TYPES.has(p.type)
    ) {
      // Short + link — SMS bodies should fit a single segment when possible.
      const sms = link ? `${p.title}\n${link}` : p.title;
      void this.sms.send({ to: user.phone_e164, body: sms });
    }
  }

  /**
   * Resolve the owning user_id for a client (if the client has a portal login),
   * then send them a notification. Silent no-op if the client has no user.
   */
  async notifyClient(clientId: string, p: Omit<NotifyPayload, 'user_id'>): Promise<void> {
    const row = await this.db
      .selectFrom('clients')
      .select('user_id')
      .where('id', '=', clientId)
      .executeTakeFirst();
    if (!row?.user_id) return;
    await this.create({ ...p, user_id: row.user_id });
  }

  /** Fan-out: notify every user with one of the given roles. */
  async notifyRoles(
    roles: ('admin' | 'staff')[],
    p: Omit<NotifyPayload, 'user_id'>,
  ): Promise<void> {
    const users = await this.db
      .selectFrom('users')
      .select('id')
      .where('role', 'in', roles)
      .where('status', '=', 'active')
      .execute();
    // Per-user create() so each opted-in recipient gets an email too.
    await Promise.all(users.map((u) => this.create({ ...p, user_id: u.id })));
  }

  list(userId: string, opts: { onlyUnread?: boolean; limit?: number } = {}): Promise<Notification[]> {
    let q = this.db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(opts.limit ?? 50);
    if (opts.onlyUnread) q = q.where('read_at', 'is', null);
    return q.execute();
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.db
      .selectFrom('notifications')
      .select(({ fn }) => fn.countAll<string>().as('c'))
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(r.c);
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .execute();
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .execute();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
