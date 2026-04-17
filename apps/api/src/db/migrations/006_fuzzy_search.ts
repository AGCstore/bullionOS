import { Kysely, sql } from 'kysely';

/**
 * 006_fuzzy_search: enable pg_trgm and add GIN trigram indexes.
 *
 * We use pg_trgm similarity (operator `%`) + `ILIKE`/`LIKE` with a GIN
 * trigram index. This gives:
 *   - Typo tolerance ("jon doe" matches "John Doe" reasonably well)
 *   - Prefix/substring matches via ILIKE accelerated by the same index
 *
 * Index choice:
 *   - gin_trgm_ops is the right opclass for ILIKE + similarity
 *   - Indexes are created CONCURRENTLY-safe? No — we create them normally
 *     inside the migration. For small tables this is instant; when the DB
 *     grows past ~1M rows we'd switch to CREATE INDEX CONCURRENTLY in a
 *     non-migration deploy step.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);

  // --- clients ---
  // Concat of searchable fields. Pre-materialize into a generated column to
  // keep the GIN index cheap at query time.
  await sql`
    ALTER TABLE clients
    ADD COLUMN search_text text
      GENERATED ALWAYS AS (
        lower(coalesce(first_name,'') || ' ' ||
              coalesce(last_name,'') || ' ' ||
              coalesce(email::text,'') || ' ' ||
              coalesce(phone,'') || ' ' ||
              coalesce(city,'') || ' ' ||
              coalesce(region,''))
      ) STORED
  `.execute(db);
  await sql`
    CREATE INDEX clients_search_trgm_idx ON clients USING gin (search_text gin_trgm_ops)
  `.execute(db);

  // --- products ---
  await sql`
    ALTER TABLE products
    ADD COLUMN search_text text
      GENERATED ALWAYS AS (
        lower(coalesce(sku,'') || ' ' ||
              coalesce(name,'') || ' ' ||
              coalesce(description,''))
      ) STORED
  `.execute(db);
  await sql`
    CREATE INDEX products_search_trgm_idx ON products USING gin (search_text gin_trgm_ops)
  `.execute(db);

  // --- invoices ---
  // Typically looked up by invoice_number (prefix-ish). Trigram works for this.
  await sql`
    CREATE INDEX invoices_number_trgm_idx ON invoices USING gin (invoice_number gin_trgm_ops)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS invoices_number_trgm_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS products_search_trgm_idx`.execute(db);
  await sql`ALTER TABLE products DROP COLUMN IF EXISTS search_text`.execute(db);
  await sql`DROP INDEX IF EXISTS clients_search_trgm_idx`.execute(db);
  await sql`ALTER TABLE clients DROP COLUMN IF EXISTS search_text`.execute(db);
}
