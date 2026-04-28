#!/usr/bin/env node
/**
 * IFS smoke test — read-only validation of the Phase 2 endpoints
 * against the real ifsclients.com API using the prod creds.
 *
 * Hits #2 ca_basic_data, #3 ca_client_address_list, #4 ca_client_address_data
 * (for the auto-picked AGC default sender), #5 ca_recipient_list, #8
 * ca_change_zipcode_service, #13 ca_get_zone_id. Does NOT call #26 —
 * label creation costs real money.
 *
 * Verifies:
 *   - Auth (creds reach IFS cleanly)
 *   - Response shapes match what our service-layer parsers expect
 *   - The "auto-pick AGC default sender" address-substring match works
 *   - End-to-end latency
 *
 * Usage:
 *   APP_ENCRYPTION_KEY=... DATABASE_PUBLIC_URL=... node scripts/ifs-smoke-test.mjs
 */

import { createDecipheriv } from 'node:crypto';
import pg from 'pg';

const KEY_B64 = process.env.APP_ENCRYPTION_KEY;
const DB_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

if (!KEY_B64) {
  console.error('APP_ENCRYPTION_KEY env var is required');
  process.exit(2);
}
if (!DB_URL) {
  console.error('DATABASE_PUBLIC_URL env var is required');
  process.exit(2);
}

const KEY = Buffer.from(KEY_B64, 'base64');
if (KEY.length !== 32) {
  console.error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  process.exit(2);
}

function decryptBlob(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', KEY, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

async function loadCreds() {
  const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT credentials_encrypted FROM integrations
       WHERE provider = 'ifs' AND is_enabled = true LIMIT 1`,
    );
    if (!res.rows.length) throw new Error('No enabled IFS integration row');
    const json = decryptBlob(res.rows[0].credentials_encrypted);
    return JSON.parse(json);
  } finally {
    await client.end();
  }
}

async function callIfs(creds, endpoint, extra = {}) {
  const url = `${creds.url.replace(/\/$/, '')}/${endpoint}`;
  const form = new URLSearchParams();
  form.set('AppUserName', creds.app_user_name);
  form.set('AppPassword', creds.app_password);
  form.set('account_id', creds.account_id);
  for (const [k, v] of Object.entries(extra)) form.set(k, String(v));
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      'user-agent': 'AGC-Desk-Smoke-Test/1.0',
    },
    body: form.toString(),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) {
    return { ok: false, ms, status: res.status, body: text.slice(0, 300) };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, ms, status: res.status, body: `non-JSON: ${text.slice(0, 200)}` };
  }
  return { ok: true, ms, status: res.status, data };
}

function summary(label, r) {
  if (!r.ok) {
    console.log(`  ✗ ${label}  ${r.ms}ms  [${r.status}] ${r.body}`);
    return false;
  }
  const status = r.data?.status;
  const msg = r.data?.message ? String(r.data.message).slice(0, 80) : '';
  const ok = status === '1' || status === 'success' || status === 1;
  const flag = ok ? '✓' : '⚠';
  console.log(`  ${flag} ${label}  ${r.ms}ms  status=${status}  ${msg}`);
  return ok;
}

async function main() {
  console.log('Loading creds from prod DB…');
  const creds = await loadCreds();
  console.log(
    `  ✓ acct=${creds.account_id}  user=${creds.app_user_name}  url=${creds.url}\n`,
  );

  console.log('1. ca_basic_data.php (#2) — enum dropdowns');
  const r2 = await callIfs(creds, 'ca_basic_data.php');
  summary('basic_data', r2);
  if (r2.ok) {
    const d = r2.data;
    const optKeys = Object.keys(d).filter((k) => Array.isArray(d[k]) && d[k].length);
    console.log(`     array keys: ${optKeys.slice(0, 8).join(', ')}${optKeys.length > 8 ? '…' : ''}`);
    // Check what we'd map to options
    const probe = (keys) => {
      for (const k of keys) {
        if (Array.isArray(d[k]) && d[k].length) {
          const sample = d[k][0];
          return `${k}[${d[k].length}] sample=${JSON.stringify(sample).slice(0, 80)}`;
        }
      }
      return '(none)';
    };
    console.log(
      '     service_types  →',
      probe(['service_type_array', 'service_types', 'service_type']),
    );
    console.log(
      '     packaging_types→',
      probe(['packaging_type_array', 'packaging_types', 'packaging_type']),
    );
    console.log(
      '     payment_types  →',
      probe(['payment_type_array', 'payment_types', 'payment_type']),
    );
    console.log(
      '     signature_types→',
      probe(['signature_type_array', 'signature_types', 'signature_type1', 'signature_type']),
    );
    console.log(
      '     label_stocks   →',
      probe(['label_stock_type_array', 'label_stock_types', 'label_stock_type']),
    );
  }

  console.log('\n2. ca_client_address_list.php (#3) — saved senders');
  const r3 = await callIfs(creds, 'ca_client_address_list.php');
  summary('senders', r3);
  let agcSenderId = null;
  if (r3.ok) {
    const list = Array.isArray(r3.data?.client_address) ? r3.data.client_address : [];
    console.log(`     ${list.length} sender(s) returned`);
    for (const s of list.slice(0, 5)) {
      console.log(
        `       id=${s.id}  primaric=${s.is_primaric}  ${(s.text || s.name || s.address1 || '').slice(0, 80)}`,
      );
    }
    const target = '8480 holcomb bridge';
    const match = list.find((s) => String(s.address1 || '').toLowerCase().includes(target));
    if (match) {
      console.log(`     ✓ AGC default matched by address: id=${match.id}`);
      agcSenderId = match.id;
    } else if (r3.data.primaric_client_address_id) {
      console.log(
        `     ⚠ no address match for "8480 Holcomb Bridge" — falling back to primaric_id=${r3.data.primaric_client_address_id}`,
      );
      agcSenderId = r3.data.primaric_client_address_id;
    } else {
      console.log('     ⚠ no AGC default + no primaric_id — wizard will use hardcoded fallback');
    }
  }

  if (agcSenderId) {
    console.log(`\n3. ca_client_address_data.php (#4) — hydrate sender ${agcSenderId}`);
    const r4 = await callIfs(creds, 'ca_client_address_data.php', {
      client_address_id: agcSenderId,
    });
    summary('sender data', r4);
    if (r4.ok) {
      const d = r4.data?.client_address_data || {};
      console.log(`       ${d.name || ''} / ${d.company_name || ''}`);
      console.log(`       ${d.address1 || ''} ${d.address2 || ''}`);
      console.log(`       ${d.city || ''}, ${d.state || ''} ${d.zip || ''}, ${d.country || ''}`);
      console.log(`       phone=${d.phone || ''} email=${d.email || ''}`);
      console.log(
        `       restricted=${d.IsAddressRestricted || 'No'}  residential=${d.is_residential}`,
      );
    }
  }

  console.log('\n4. ca_recipient_list.php (#5) — recipient typeahead (empty term)');
  const r5 = await callIfs(creds, 'ca_recipient_list.php', { term: '' });
  summary('recipients', r5);
  if (r5.ok) {
    const list = Array.isArray(r5.data?.recipient_list) ? r5.data.recipient_list : [];
    console.log(`     ${list.length} recipient(s) on file`);
    for (const r of list.slice(0, 3)) {
      console.log(`       id=${r.id}  ${(r.name || '').slice(0, 80)}`);
    }
  }

  console.log('\n5. ca_change_zipcode_service.php (#8) — ATL → NYC FedEx Ground compat');
  const r8 = await callIfs(creds, 'ca_change_zipcode_service.php', {
    ca_country: 'United States',
    client_country: 'United States',
    service_type: 'FEDEX_GROUND',
    client_zip: '10001',
  });
  summary('service_restriction', r8);
  if (r8.ok) {
    console.log(`     is_restricted=${r8.data?.is_restricted}  message=${(r8.data?.message || '').slice(0, 80)}`);
  }

  console.log('\n6. ca_get_zone_id.php (#13) — ATL→NYC zone');
  const r13 = await callIfs(creds, 'ca_get_zone_id.php', {
    recipient_zip: '10001',
    recipient_country: 'United States',
    shipper_zip: '30022',
    shipper_country: 'United States',
    service_type: 'FEDEX_GROUND',
    recipient_city: 'New York',
    recipient_state: 'NY',
    shipper_city: 'Alpharetta',
    shipper_state: 'GA',
  });
  summary('zone_id', r13);
  if (r13.ok) {
    console.log(`     zone_id=${r13.data?.zone_id}  zone_name=${r13.data?.zone_name}`);
  }

  console.log('\nSmoke test complete.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
