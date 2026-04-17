import { Kysely, sql } from 'kysely';

/**
 * 002_trading: products, pricing rules, inventory, invoices, line items.
 *
 * Design notes:
 *  - All money columns are NUMERIC(20,8). Eight decimals accommodates fractional-troy-oz
 *    pricing without precision loss. We never do floating-point math on money at rest.
 *  - Weights + purities are NUMERIC(20,8) for the same reason.
 *  - invoice_number is human-facing ("2026-000123") and generated via a Postgres sequence
 *    so concurrent inserts don't collide.
 *  - Pricing rules: one row per (scope, metal | product). Product override takes precedence
 *    over metal default at resolution time. Enforced by partial unique indexes below.
 *  - Invoice line items snapshot spot + metal content at calculation time, so a finalized
 *    invoice is fully reproducible even if the product or rules change later.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- enums as CHECK constraints for flexibility on rename ---

  // --- products ---
  await db.schema
    .createTable('products')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('sku', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('metal', 'text', (c) =>
      c.notNull().check(sql`metal in ('gold','silver','platinum','palladium')`),
    )
    .addColumn('category', 'text', (c) =>
      c
        .notNull()
        .check(sql`category in ('coin','bar','round','numismatic','jewelry','other')`),
    )
    // Gross weight (1 troy oz of a Silver Eagle is 1.0).
    .addColumn('weight_troy_oz', 'numeric(20, 8)', (c) => c.notNull())
    // Purity as fraction: 0.999, 0.9167, etc.
    .addColumn('purity', 'numeric(20, 8)', (c) =>
      c.notNull().check(sql`purity > 0 and purity <= 1`),
    )
    // Metal content (= weight * purity) stored for speed + integrity.
    .addColumn('metal_content_troy_oz', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('description', 'text')
    .addColumn('image_url', 'text')
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('show_on_website', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('products_metal_idx').on('products').column('metal').execute();
  await db.schema
    .createIndex('products_active_website_idx')
    .on('products')
    .columns(['is_active', 'show_on_website'])
    .execute();

  await sql`
    CREATE TRIGGER products_set_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);

  // --- pricing_rules ---
  // One row per scope: metal default OR per-product override.
  await db.schema
    .createTable('pricing_rules')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('scope', 'text', (c) =>
      c.notNull().check(sql`scope in ('metal','product')`),
    )
    .addColumn('metal', 'text', (c) =>
      c.check(sql`metal is null or metal in ('gold','silver','platinum','palladium')`),
    )
    .addColumn('product_id', 'uuid', (c) =>
      c.references('products.id').onDelete('cascade'),
    )
    // 'percent' → value is a percent (e.g., 3.5 = 3.5% premium).
    // 'flat'    → value is USD per troy oz of metal content.
    .addColumn('buy_premium_type', 'text', (c) =>
      c.notNull().check(sql`buy_premium_type in ('percent','flat')`),
    )
    .addColumn('buy_premium_value', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('sell_premium_type', 'text', (c) =>
      c.notNull().check(sql`sell_premium_type in ('percent','flat')`),
    )
    .addColumn('sell_premium_value', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('effective_from', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('effective_until', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // Shape constraint: metal rules have metal; product rules have product_id.
    .addCheckConstraint(
      'pricing_rules_shape',
      sql`(scope = 'metal' and metal is not null and product_id is null)
       or (scope = 'product' and product_id is not null)`,
    )
    .execute();

  // Only one active metal default per metal, and one active product override per product.
  await sql`
    CREATE UNIQUE INDEX pricing_rules_metal_active_uniq
    ON pricing_rules (metal)
    WHERE scope = 'metal' AND is_active = true
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX pricing_rules_product_active_uniq
    ON pricing_rules (product_id)
    WHERE scope = 'product' AND is_active = true
  `.execute(db);

  await sql`
    CREATE TRIGGER pricing_rules_set_updated_at
    BEFORE UPDATE ON pricing_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);

  // --- inventory ---
  await db.schema
    .createTable('inventory')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('product_id', 'uuid', (c) =>
      c.notNull().references('products.id').onDelete('restrict').unique(),
    )
    .addColumn('quantity_on_hand', 'integer', (c) =>
      c.notNull().defaultTo(0).check(sql`quantity_on_hand >= 0`),
    )
    .addColumn('quantity_reserved', 'integer', (c) =>
      c.notNull().defaultTo(0).check(sql`quantity_reserved >= 0`),
    )
    .addColumn('location', 'text', (c) => c.notNull().defaultTo('main'))
    .addColumn('weighted_avg_cost', 'numeric(20, 8)', (c) => c.notNull().defaultTo(0))
    .addColumn('last_purchase_price', 'numeric(20, 8)')
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'inventory_reserved_le_on_hand',
      sql`quantity_reserved <= quantity_on_hand`,
    )
    .execute();

  await sql`
    CREATE TRIGGER inventory_set_updated_at
    BEFORE UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);

  // --- inventory_movements (audit trail) ---
  await db.schema
    .createTable('inventory_movements')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('product_id', 'uuid', (c) =>
      c.notNull().references('products.id').onDelete('restrict'),
    )
    .addColumn('delta', 'integer', (c) => c.notNull().check(sql`delta <> 0`))
    .addColumn('reason', 'text', (c) =>
      c
        .notNull()
        .check(
          sql`reason in ('purchase','sale','adjustment','return','damage','manual')`,
        ),
    )
    .addColumn('invoice_id', 'uuid')
    .addColumn('unit_cost', 'numeric(20, 8)')
    .addColumn('notes', 'text')
    .addColumn('actor_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('inventory_movements_product_idx')
    .on('inventory_movements')
    .columns(['product_id', 'created_at'])
    .execute();

  // --- invoices ---
  await sql`CREATE SEQUENCE invoice_number_seq START 1`.execute(db);

  await db.schema
    .createTable('invoices')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Human-facing, e.g., "2026-000123". Generated in-app on creation.
    .addColumn('invoice_number', 'text', (c) => c.notNull().unique())
    .addColumn('client_id', 'uuid', (c) =>
      c.notNull().references('clients.id').onDelete('restrict'),
    )
    // 'sell' = we sell to client, 'buy' = we buy from client.
    .addColumn('type', 'text', (c) => c.notNull().check(sql`type in ('buy','sell')`))
    .addColumn('status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('draft')
        .check(sql`status in ('draft','finalized','paid','shipped','canceled')`),
    )
    .addColumn('subtotal', 'numeric(20, 8)', (c) => c.notNull().defaultTo(0))
    .addColumn('tax', 'numeric(20, 8)', (c) => c.notNull().defaultTo(0))
    .addColumn('shipping', 'numeric(20, 8)', (c) => c.notNull().defaultTo(0))
    .addColumn('total', 'numeric(20, 8)', (c) => c.notNull().defaultTo(0))
    .addColumn('payment_method', 'text', (c) =>
      c.check(
        sql`payment_method is null or payment_method in ('wire','check','ach','cash','crypto','card')`,
      ),
    )
    .addColumn('payment_status', 'text', (c) =>
      c
        .notNull()
        .defaultTo('unpaid')
        .check(sql`payment_status in ('unpaid','partial','paid','refunded')`),
    )
    .addColumn('notes', 'text')
    .addColumn('created_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('finalized_at', 'timestamptz')
    .addColumn('paid_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('invoices_client_idx')
    .on('invoices')
    .columns(['client_id', 'created_at'])
    .execute();
  await db.schema
    .createIndex('invoices_status_idx')
    .on('invoices')
    .column('status')
    .execute();

  await sql`
    CREATE TRIGGER invoices_set_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `.execute(db);

  // --- invoice_line_items ---
  // All fields are SNAPSHOTS at calculation time so finalized invoices are reproducible.
  await db.schema
    .createTable('invoice_line_items')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('invoice_id', 'uuid', (c) =>
      c.notNull().references('invoices.id').onDelete('cascade'),
    )
    .addColumn('product_id', 'uuid', (c) =>
      c.notNull().references('products.id').onDelete('restrict'),
    )
    .addColumn('position', 'integer', (c) => c.notNull())
    .addColumn('quantity', 'integer', (c) => c.notNull().check(sql`quantity > 0`))
    // Snapshots
    .addColumn('product_name_snapshot', 'text', (c) => c.notNull())
    .addColumn('unit_weight_troy_oz', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('unit_purity', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('unit_metal_content_troy_oz', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('spot_price_per_oz', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('premium_type', 'text', (c) =>
      c.notNull().check(sql`premium_type in ('percent','flat')`),
    )
    .addColumn('premium_value', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('unit_price', 'numeric(20, 8)', (c) => c.notNull())
    .addColumn('line_total', 'numeric(20, 8)', (c) => c.notNull())
    // Manager override tracking
    .addColumn('is_overridden', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('override_reason', 'text')
    .addColumn('override_by_user_id', 'uuid', (c) =>
      c.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('invoice_line_items_invoice_position_uniq', [
      'invoice_id',
      'position',
    ])
    .execute();

  await db.schema
    .createIndex('invoice_line_items_invoice_idx')
    .on('invoice_line_items')
    .column('invoice_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    'invoice_line_items',
    'invoices',
    'inventory_movements',
    'inventory',
    'pricing_rules',
    'products',
  ]) {
    await sql`DROP TABLE IF EXISTS ${sql.raw(t)} CASCADE`.execute(db);
  }
  await sql`DROP SEQUENCE IF EXISTS invoice_number_seq`.execute(db);
}
