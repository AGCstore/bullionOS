import { Kysely } from 'kysely';

/**
 * 019_product_display_override
 *
 * Adds an optional per-product override for the display category. When
 * set, the frontend's rendering loops use this value instead of running
 * the name-heuristic in deriveDisplayCategory(). That lets operators:
 *
 *   1. Correct misrouted items (e.g. a Pre-1933 coin that the regex
 *      didn't catch because the name uses "Dated 1928" wording).
 *   2. Pin a product to a custom category they've added on
 *      /admin/categories (the builtin heuristic has no knowledge of
 *      admin-created categories).
 *
 * Value is a text slug (e.g. "silver_junk", "gold_coins", or an admin-
 * defined "vintage_lot_4"). No FK — custom categories live in the
 * app_settings JSON blob rather than a dedicated table, and the
 * frontend resolves unknown slugs back to the 'other' bucket so a
 * deleted custom category can't orphan a product.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('products')
    .addColumn('display_category_override', 'text')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('products')
    .dropColumn('display_category_override')
    .execute();
}
