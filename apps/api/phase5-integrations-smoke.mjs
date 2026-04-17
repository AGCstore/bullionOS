// Phase 5 smoke: admin configures UPS, creds are encrypted at rest, reveal blocked.
import pg from 'pg';

const API = 'http://localhost:4000/api/v1';

async function req(method, path, body, token) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(API + path, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const admin = await req('POST', '/auth/login', {
    email: 'admin@agc.local',
    password: 'ChangeMe_Admin_123!',
  });
  const TOKEN = admin.access_token;

  // --- List: all four providers return "not configured" ---
  console.log('--- listStatus (fresh) ---');
  const s0 = await req('GET', '/admin/integrations', null, TOKEN);
  s0.forEach((x) =>
    console.log(`  ${x.provider.padEnd(10)} configured=${x.configured} enabled=${x.enabled}`),
  );
  if (s0.find((x) => x.configured)) throw new Error('expected none configured');

  // --- Configure UPS with dummy creds ---
  console.log('\n--- configure UPS ---');
  const upsCreds = {
    client_id: 'DUMMY_UPS_CLIENT_ID_FOR_SMOKE_TEST',
    client_secret: 'DUMMY_UPS_SECRET_FOR_SMOKE_TEST_VALUE_ONLY',
    account_number: 'A1B2C3',
    environment: 'cie',
  };
  const configured = await req('PUT', '/admin/integrations/ups', upsCreds, TOKEN);
  console.log('  configured=', configured.configured);
  console.log('  display_hint=', configured.display_hint);
  console.log('  redacted.client_secret=', configured.redacted_credentials.client_secret);
  if (configured.redacted_credentials.client_secret.includes('DUMMY_UPS_SECRET')) {
    throw new Error('redacted response leaked the raw secret!');
  }

  // --- Verify at-rest encryption: raw bytea must NOT contain the plaintext ---
  console.log('\n--- verify DB ciphertext does NOT contain plaintext ---');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(
    'SELECT credentials_encrypted FROM integrations WHERE provider = $1',
    ['ups'],
  );
  await client.end();
  if (rows.length !== 1) throw new Error('expected 1 row');
  const blob = rows[0].credentials_encrypted; // Buffer
  console.log(`  bytea length: ${blob.length} bytes`);
  const asString = blob.toString('binary');
  if (asString.includes(upsCreds.client_secret)) {
    throw new Error('PLAINTEXT secret visible in DB bytea!');
  }
  if (asString.includes(upsCreds.client_id)) {
    throw new Error('PLAINTEXT client_id visible in DB bytea!');
  }
  console.log('  ✓ ciphertext does not contain plaintext');

  // --- Test connection: will fail because creds are fake, which is expected ---
  console.log('\n--- test connection (expected to fail — creds are fake) ---');
  const test = await req('POST', '/admin/integrations/ups/test', {}, TOKEN);
  console.log('  ok=', test.ok, 'message=', test.message.slice(0, 80));

  // Status should now show last_test_ok=false
  const s1 = await req('GET', '/admin/integrations', null, TOKEN);
  const ups = s1.find((x) => x.provider === 'ups');
  console.log('  after test: last_test_ok=', ups.last_test_ok, 'msg len=', (ups.last_test_message ?? '').length);

  // --- Disable without deleting ---
  console.log('\n--- toggle enabled off ---');
  await fetch(API + '/admin/integrations/ups/enabled', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  const s2 = await req('GET', '/admin/integrations', null, TOKEN);
  const ups2 = s2.find((x) => x.provider === 'ups');
  console.log('  enabled=', ups2.enabled, 'configured=', ups2.configured);

  // --- Remove ---
  console.log('\n--- remove ---');
  await fetch(API + '/admin/integrations/ups', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + TOKEN },
  });
  const s3 = await req('GET', '/admin/integrations', null, TOKEN);
  const ups3 = s3.find((x) => x.provider === 'ups');
  console.log('  after remove: configured=', ups3.configured);
  if (ups3.configured) throw new Error('remove did not work');

  console.log('\nALL PASS.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
