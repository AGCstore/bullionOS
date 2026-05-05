/* eslint-disable no-console */
/**
 * One-shot: decrypt AGC's Aurbitrage credentials and re-encrypt for
 * Trubee's tenant. Each tenant has its own APP_ENCRYPTION_KEY, so
 * the encrypted blob can't be copied as-is — must round-trip through
 * plaintext with the right key on each end.
 *
 * Run from /e/bullion-os/apps/api so pg + pnpm-hoisted deps resolve:
 *   node ../../scripts/copy-aurbitrage-to-trubee.mjs
 */
import pg from 'pg';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const AGC_DB = 'postgresql://postgres:p46FAzqfoRDZtoDkYxw34mycyRUDn6SW@nozomi.proxy.rlwy.net:42130/railway';
const TRU_DB = 'postgresql://postgres:lLBCCxCTCssuVBMCxIoYoGpUZITNpzKw@shinkansen.proxy.rlwy.net:56179/railway';
const AGC_KEY = Buffer.from('CkagSS60c1t094/lRd6LQ2cRKR6sqzTxS1iy8GOrsyY=', 'base64');
const TRU_KEY = Buffer.from('GeFIZHruQWf92QH4eSeD3P3ImSsvX+jiFV5pdM9cOeQ=', 'base64');

function decrypt(blob, key) {
  const nonce = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ct = blob.subarray(12, blob.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
function encrypt(plaintext, key) {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([nonce, ct, tag]);
}

const src = new pg.Client({ connectionString: AGC_DB });
const dst = new pg.Client({ connectionString: TRU_DB });
await src.connect();
await dst.connect();

const r = await src.query("SELECT * FROM integrations WHERE provider='aurbitrage'");
if (r.rows.length === 0) {
  console.log('AGC has no aurbitrage row');
  await src.end();
  await dst.end();
  process.exit(0);
}

const plaintext = decrypt(r.rows[0].credentials_encrypted, AGC_KEY);
console.log('AGC aurbitrage decrypted, JSON keys:', Object.keys(JSON.parse(plaintext)).join(', '));

const reblob = encrypt(plaintext, TRU_KEY);

await dst.query(
  `INSERT INTO integrations (provider, credentials_encrypted, display_hint, is_enabled)
   VALUES ('aurbitrage', $1, 'API key', true)
   ON CONFLICT (provider) DO UPDATE SET
     credentials_encrypted = EXCLUDED.credentials_encrypted,
     is_enabled = true,
     updated_at = now()`,
  [reblob],
);

const verify = await dst.query(
  "SELECT credentials_encrypted FROM integrations WHERE provider='aurbitrage'",
);
const back = decrypt(verify.rows[0].credentials_encrypted, TRU_KEY);
const parsed = JSON.parse(back);
console.log('Trubee aurbitrage installed + verified.');
console.log('  api_key length:', parsed.api_key?.length, 'chars');
console.log('  url:           ', parsed.url);

await src.end();
await dst.end();
