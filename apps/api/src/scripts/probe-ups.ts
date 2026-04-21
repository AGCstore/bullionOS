/* eslint-disable no-console */
/**
 * Standalone UPS tracking diagnostic. Doesn't boot Nest — just reads
 * the integrations row directly and calls the UPS Tracking API with
 * the stored creds. Tells us whether the adapter path would work
 * independent of the cron.
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx src/scripts/probe-ups.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import * as crypto from 'node:crypto';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  const { rows: intgRows } = await pool.query(
    "SELECT provider, is_enabled, secrets, display_hint, last_test_ok FROM integrations WHERE provider = 'ups'",
  );
  if (intgRows.length === 0) {
    console.log('No UPS integration row');
    await pool.end();
    return;
  }
  const row = intgRows[0];
  console.log('UPS integration:', {
    enabled: row.is_enabled,
    display_hint: row.display_hint,
    last_test_ok: row.last_test_ok,
  });

  // Decrypt the secrets column the same way CryptoService does.
  // Layout: nonce(12) || ciphertext || tag(16); key is APP_ENCRYPTION_KEY.
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) {
    console.log('APP_ENCRYPTION_KEY missing; cannot decrypt secrets');
    await pool.end();
    return;
  }
  const keyBuf = Buffer.from(key, 'base64');
  if (keyBuf.length !== 32) {
    console.log(`Key length ${keyBuf.length} (want 32 bytes)`);
    await pool.end();
    return;
  }

  const blob: Buffer = row.secrets;
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  const creds = JSON.parse(plain.toString('utf8')) as {
    client_id: string;
    client_secret: string;
    environment: 'cie' | 'production';
  };
  console.log('Creds environment:', creds.environment, 'id:', creds.client_id.slice(0, 6) + '…');

  const baseUrl =
    creds.environment === 'production'
      ? 'https://onlinetools.ups.com'
      : 'https://wwwcie.ups.com';

  // Step 1: Get OAuth token
  console.log('\n[1/2] POST /security/v1/oauth/token');
  const tokenRes = await fetch(`${baseUrl}/security/v1/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  console.log(' status:', tokenRes.status);
  if (!tokenRes.ok) {
    console.log(' body:', (await tokenRes.text()).slice(0, 500));
    await pool.end();
    return;
  }
  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    console.log(' no access_token in response');
    await pool.end();
    return;
  }
  console.log(' token obtained (len', tokenBody.access_token.length, ')');

  // Step 2: Look up every open UPS tracking number
  const { rows: open } = await pool.query(
    "SELECT id, tracking_number, status FROM shipments WHERE carrier = 'ups' AND status IN ('label_created','in_transit','out_for_delivery','exception') AND tracking_number IS NOT NULL",
  );
  console.log(`\n[2/2] ${open.length} open UPS shipment(s)`);

  for (const s of open) {
    console.log(`\n→ ${s.tracking_number} (${s.status})`);
    const tRes = await fetch(
      `${baseUrl}/api/track/v1/details/${encodeURIComponent(s.tracking_number)}`,
      {
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
          transId: `agc-probe-${Date.now()}`,
          transactionSrc: 'agc-crm-probe',
        },
      },
    );
    console.log(' status:', tRes.status);
    const body = await tRes.text();
    console.log(' body (first 800):', body.slice(0, 800));
  }

  await pool.end();
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
