import { Kysely, sql } from 'kysely';

/**
 * 036_ifs_shipments
 *
 * IFS Clients (ifsclients.com) is the FedEx-reseller AGC uses for
 * label creation. Their dashboard at ifsclients.com is the source of
 * truth — operators log in there to create labels + view shipments.
 * Phase 1 of the AGC Desk integration mirrors that dashboard inline
 * so operators don't have to context-switch to ifsclients.com just
 * to check the day's shipments.
 *
 * Storage strategy: cache the IFS shipment list in a flat local table.
 * Sync runs (15 min @Cron + manual "Refresh") wipe + reinsert the
 * whole snapshot — IFS's API doesn't expose deltas, so a full reload
 * is the cleanest model and the per-customer volume is small enough
 * that it's a non-issue.
 *
 * Singleton sync_state row mirrors the aurbitrage pattern (035) for
 * "synced 3m ago" badges + last-error surfacing on the UI.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ifs_shipments')
    .addColumn('id', 'uuid', (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    // IFS-side identity (whichever they expose — usually shipment_id +
    // tracking_no on the response).
    .addColumn('ifs_shipment_id', 'text', (c) => c.notNull())
    .addColumn('tracking_number', 'text')
    .addColumn('carrier', 'text') // FedEx, UPS, etc.
    .addColumn('service_type', 'text')
    .addColumn('label_status', 'text') // ACTIVE / VOIDED / etc.
    // Sender side
    .addColumn('sender_name', 'text')
    .addColumn('sender_company', 'text')
    .addColumn('sender_address', 'text')
    // Recipient side
    .addColumn('recipient_name', 'text')
    .addColumn('recipient_company', 'text')
    .addColumn('recipient_address', 'text')
    .addColumn('recipient_city', 'text')
    .addColumn('recipient_state', 'text')
    .addColumn('recipient_zip', 'text')
    .addColumn('recipient_country', 'text')
    // Money + cost
    .addColumn('declared_value', sql`numeric(20, 2)`)
    .addColumn('cost', sql`numeric(20, 2)`)
    // Dates
    .addColumn('ship_date', 'text')
    .addColumn('delivered_at', 'timestamptz')
    .addColumn('voided_at', 'timestamptz')
    // The label PDF lives on IFS's servers. We don't mirror the bytes
    // — we just point at the URL when one's available.
    .addColumn('label_url', 'text')
    .addColumn('tracking_url', 'text')
    // Free-form reference / PO field operators can attach to a label.
    .addColumn('reference', 'text')
    // Raw API response so reparsing is possible without re-syncing.
    .addColumn('raw_payload', 'jsonb')
    .addColumn('synced_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    CREATE INDEX ifs_shipments_tracking_idx
      ON ifs_shipments (tracking_number)
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX ifs_shipments_ifs_id_uq
      ON ifs_shipments (ifs_shipment_id)
  `.execute(db);
  await sql`
    CREATE INDEX ifs_shipments_synced_idx
      ON ifs_shipments (synced_at DESC)
  `.execute(db);

  // Singleton sync-state. id=1 enforced via CHECK so upserts target
  // the same row on every sync.
  await db.schema
    .createTable('ifs_sync_state')
    .addColumn('id', 'integer', (c) =>
      c.primaryKey().defaultTo(1).check(sql`id = 1`),
    )
    .addColumn('last_synced_at', 'timestamptz')
    .addColumn('last_sync_status', 'text') // 'ok' | 'error'
    .addColumn('last_sync_message', 'text')
    .addColumn('last_sync_count', 'integer')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ifs_sync_state').ifExists().execute();
  await db.schema.dropTable('ifs_shipments').ifExists().execute();
}
