/**
 * One-shot client import from the Aureus-format CSV export.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx src/db/import-clients.ts <path-to-csv>
 *
 * File shape (header row, BOM-prefixed):
 *   Type,Name,Client ID,Email,Phone,Address,City,State,ZIP,Status,...
 *
 * Rules applied:
 *   - Type 'Person'  → client_type = 'retail'
 *     Type 'Company' → client_type = 'wholesaler'
 *   - Names starting with "*DO NOT USE*" are SKIPPED.
 *   - Email matching /^no-name-.*@aureus\.com$/ is treated as null
 *     (these are Aureus placeholders; enabling the portal would bounce).
 *   - Address = 'No address specified on file.' → null.
 *   - City/State/ZIP of '-' → null.
 *   - For Persons: split on first space into first_name + last_name.
 *     For Companies: first_name = full company name, last_name = '—'
 *     (schema requires min 1 char; the detail view renders company names
 *     as a single line anyway).
 *
 * Idempotency:
 *   - If a row has a real email → upsert by email.
 *   - Otherwise → skip if a row with the same (first_name, last_name)
 *     exists. Prevents re-importing duplicates on re-runs.
 *
 * Counters are printed at the end. Exits 0 on success, non-zero if any
 * DB error occurs (the transaction rolls back in that case).
 */

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { ClientType, DB } from './types';

interface ParsedRow {
  type: 'Person' | 'Company';
  name: string;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  status: string;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx import-clients.ts <csv path>');
    process.exit(2);
  }
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_PUBLIC_URL;
  if (!connectionString) {
    console.error('Set DATABASE_URL (or DATABASE_PUBLIC_URL).');
    process.exit(2);
  }

  const raw = await fs.readFile(path, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    console.error('No rows parsed.');
    process.exit(1);
  }

  // Local Postgres (localhost) rejects SSL; managed hosts (Railway) require
  // it. Detect host and only set SSL on non-local connections.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        ssl: isLocal ? false : { rejectUnauthorized: false },
      }),
    }),
  });

  let inserted = 0;
  let matched = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  try {
    for (const r of rows) {
      const parsed = normalizeRow(r);
      if (!parsed) {
        skipped++;
        skipReasons['unknown_type'] = (skipReasons['unknown_type'] ?? 0) + 1;
        continue;
      }
      if (parsed.name.startsWith('*DO NOT USE*')) {
        skipped++;
        skipReasons['do_not_use'] = (skipReasons['do_not_use'] ?? 0) + 1;
        continue;
      }

      const { first_name, last_name } = splitName(parsed);
      const client_type: ClientType =
        parsed.type === 'Company' ? 'wholesaler' : 'retail';

      // Dedup: email-first, then (first_name,last_name).
      let existing: { id: string } | undefined;
      if (parsed.email) {
        existing = await db
          .selectFrom('clients')
          .select('id')
          .where('email', '=', parsed.email.toLowerCase())
          .executeTakeFirst();
      }
      if (!existing) {
        existing = await db
          .selectFrom('clients')
          .select('id')
          .where('first_name', '=', first_name)
          .where('last_name', '=', last_name)
          .executeTakeFirst();
      }

      if (existing) {
        matched++;
        // Best-effort merge: backfill any fields we have that are currently null.
        await db
          .updateTable('clients')
          .where('id', '=', existing.id)
          .set({
            client_type,
            ...(parsed.email ? { email: parsed.email.toLowerCase() } : {}),
            ...(parsed.phone ? { phone: parsed.phone } : {}),
            ...(parsed.address_line1
              ? { address_line1: parsed.address_line1 }
              : {}),
            ...(parsed.city ? { city: parsed.city } : {}),
            ...(parsed.region ? { region: parsed.region } : {}),
            ...(parsed.postal_code ? { postal_code: parsed.postal_code } : {}),
          })
          .execute();
        continue;
      }

      await db
        .insertInto('clients')
        .values({
          first_name,
          last_name,
          email: parsed.email ? parsed.email.toLowerCase() : null,
          phone: parsed.phone,
          address_line1: parsed.address_line1,
          city: parsed.city,
          region: parsed.region,
          postal_code: parsed.postal_code,
          client_type,
        })
        .execute();
      inserted++;
    }
  } finally {
    await db.destroy();
  }

  console.log(`✓ Client import complete`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Matched (updated):  ${matched}`);
  console.log(`  Skipped:  ${skipped}`);
  for (const [reason, n] of Object.entries(skipReasons)) {
    console.log(`    · ${reason}: ${n}`);
  }
  console.log(`  Total rows seen:    ${rows.length}`);
}

function normalizeRow(r: Record<string, string>): ParsedRow | null {
  const type = r.Type?.trim();
  if (type !== 'Person' && type !== 'Company') return null;

  const email = r.Email?.trim() || null;
  const placeholderEmail = email && /^no-name-.*@aureus\.com$/i.test(email);

  const addressRaw = r.Address?.trim() || '';
  const address_line1 =
    !addressRaw || addressRaw === 'No address specified on file.' ? null : addressRaw;

  const city = r.City?.trim() && r.City.trim() !== '-' ? r.City.trim() : null;
  const region = r.State?.trim() && r.State.trim() !== '-' ? r.State.trim() : null;
  const postal_code = r.ZIP?.trim() && r.ZIP.trim() !== '-' ? r.ZIP.trim() : null;

  return {
    type,
    name: r.Name?.trim() ?? '',
    email: placeholderEmail ? null : email,
    phone: r.Phone?.trim() || null,
    address_line1,
    city,
    region,
    postal_code,
    status: r.Status?.trim() ?? '',
  };
}

function splitName(p: ParsedRow): { first_name: string; last_name: string } {
  if (p.type === 'Company') {
    return { first_name: p.name.slice(0, 80) || 'Unknown', last_name: '—' };
  }
  const parts = p.name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: 'Unknown', last_name: '—' };
  if (parts.length === 1) return { first_name: parts[0].slice(0, 80), last_name: '—' };
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  return { first_name: first.slice(0, 80), last_name: last.slice(0, 80) };
}

/** RFC-4180-ish CSV parser. Handles BOM, quoted commas, escaped "". */
function parseCsv(text: string): Array<Record<string, string>> {
  const stripped = text.replace(/^\uFEFF/, '');
  const lines: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inQuotes) {
      if (ch === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (field !== '' || row.length > 0) {
          row.push(field);
          lines.push(row);
          row = [];
          field = '';
        }
        if (ch === '\r' && stripped[i + 1] === '\n') i++;
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    lines.push(row);
  }
  if (lines.length === 0) return [];
  const header = lines[0];
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i];
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = r[j] ?? '';
    }
    out.push(obj);
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
