import { Kysely, sql } from 'kysely';

/**
 * 013_shipment_tracking_events
 *
 * Persistent tracking-event history per shipment. Every carrier poll result
 * and every webhook payload lands here as a normalized row. The shipment's
 * top-level `status` column remains the "latest known" state; this table
 * holds the full audit trail with original payloads.
 *
 * Indexes:
 *   - (shipment_id, occurred_at DESC) covers the common "latest events for
 *     shipment X" query.
 *   - unique (shipment_id, carrier_event_id) prevents duplicate ingestion
 *     from overlapping webhook + poll paths when the carrier supplies a
 *     stable event id.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('shipment_tracking_events')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('shipment_id', 'uuid', (c) =>
      c.notNull().references('shipments.id').onDelete('cascade'),
    )
    // denormalized for cheap queries without the shipments join
    .addColumn('carrier', 'text', (c) =>
      c.notNull().check(sql`carrier in ('ups','fedex','usps','other')`),
    )
    .addColumn('tracking_number', 'text')
    // Our internal normalized status (matches shipments.status).
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .check(
          sql`status in ('label_created','in_transit','out_for_delivery','delivered','exception','returned')`,
        ),
    )
    .addColumn('description', 'text')
    // When the event actually happened at the carrier (parsed from payload).
    .addColumn('occurred_at', 'timestamptz', (c) => c.notNull())
    // Carrier-provided event id when available — used for idempotency.
    .addColumn('carrier_event_id', 'text')
    // Full raw payload for forensics (compressed by Postgres automatically).
    .addColumn('raw_payload', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    // Where did this event come from?
    .addColumn('source', 'text', (c) =>
      c.notNull().check(sql`source in ('webhook','poll','manual')`),
    )
    .addColumn('inserted_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('shipment_tracking_events_shipment_occurred_idx')
    .on('shipment_tracking_events')
    .columns(['shipment_id', 'occurred_at desc'])
    .execute();

  // Idempotency guard when the carrier gives us a stable event id.
  await sql`
    CREATE UNIQUE INDEX shipment_tracking_events_carrier_event_uniq
      ON shipment_tracking_events (shipment_id, carrier_event_id)
      WHERE carrier_event_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('shipment_tracking_events').ifExists().execute();
}
