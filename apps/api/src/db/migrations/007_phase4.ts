import { Kysely, sql } from 'kysely';

/**
 * 007_phase4: messages + user phone/SMS prefs.
 *
 * Messaging is scoped to a deal_request for now. Each row is a single post
 * from either the requesting client or a staff/admin user; `author_role`
 * records which side wrote it for fast UI rendering without a join.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('messages')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('deal_request_id', 'uuid', (c) =>
      c.notNull().references('deal_requests.id').onDelete('cascade'),
    )
    .addColumn('author_user_id', 'uuid', (c) =>
      c.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('author_role', 'text', (c) =>
      c.notNull().check(sql`author_role in ('admin','staff','client')`),
    )
    .addColumn('body', 'text', (c) => c.notNull().check(sql`length(trim(body)) > 0`))
    .addColumn('read_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('messages_request_created_idx')
    .on('messages')
    .columns(['deal_request_id', 'created_at'])
    .execute();

  // Per-user SMS opt-in + verified phone. We store the raw E.164 number
  // separately from clients.phone so admins can edit the client's display
  // phone without breaking the user's verified number.
  await db.schema
    .alterTable('users')
    .addColumn('phone_e164', 'text')
    .addColumn('phone_verified_at', 'timestamptz')
    .addColumn('sms_notifications', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    .dropColumn('sms_notifications')
    .dropColumn('phone_verified_at')
    .dropColumn('phone_e164')
    .execute();
  await db.schema.dropTable('messages').ifExists().execute();
}
