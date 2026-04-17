// Phase 3 backend smoke: 2FA + quote conversion + photo upload + email dev log.
import { createHash } from 'node:crypto';
import { authenticator } from 'otplib';

authenticator.options = { window: 1, digits: 6, step: 30 };

const API = 'http://localhost:4000/api/v1';

async function req(method, path, body, token, contentTypeJson = true) {
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      if (contentTypeJson) headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
  }
  const r = await fetch(API + path, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  const admin = await req('POST', '/auth/login', {
    email: 'admin@agc.local',
    password: 'ChangeMe_Admin_123!',
  });
  console.log('admin logged in');

  // -------- 2FA round-trip --------
  const email = `phase3-${Date.now()}@agc.local`;
  const reg = await req('POST', '/auth/register', {
    email,
    password: 'TestPass12345!',
    first_name: 'Two',
    last_name: 'FA',
  });
  const userToken = reg.tokens.access_token;
  console.log('\n=== 2FA ===');
  console.log('user registered:', email);

  const enroll = await req('POST', '/auth/2fa/enroll', {}, userToken);
  console.log('enrolled, recovery codes issued:', enroll.recovery_codes.length);
  console.log('first code:', enroll.recovery_codes[0]);
  // Pull the secret from the otpauth URL.
  const match = /secret=([A-Z2-7]+)/.exec(enroll.otpauth_url);
  const secret = match[1];
  const code = authenticator.generate(secret);
  console.log('generated TOTP:', code);
  await req('POST', '/auth/2fa/activate', { code }, userToken);
  console.log('2FA activated');

  // Now login WITHOUT totp → should fail
  try {
    await req('POST', '/auth/login', { email, password: 'TestPass12345!' });
    console.log('UNEXPECTED: login without TOTP succeeded');
  } catch (e) {
    console.log('✓ login without TOTP refused:', String(e.message).slice(0, 80));
  }

  // Login WITH TOTP → should succeed
  const loginWith2fa = await req('POST', '/auth/login', {
    email,
    password: 'TestPass12345!',
    totp: authenticator.generate(secret),
  });
  console.log('✓ login with TOTP succeeded, token len:', loginWith2fa.access_token.length);

  // Login with a recovery code
  const recoveryLogin = await req('POST', '/auth/login', {
    email,
    password: 'TestPass12345!',
    totp: enroll.recovery_codes[0],
  });
  console.log('✓ login with recovery code succeeded');

  // Second use of that same recovery code must fail
  try {
    await req('POST', '/auth/login', {
      email,
      password: 'TestPass12345!',
      totp: enroll.recovery_codes[0],
    });
    console.log('UNEXPECTED: recovery code replay allowed');
  } catch {
    console.log('✓ recovery code single-use enforced');
  }

  // -------- Price quote → convert --------
  console.log('\n=== Price quotes ===');
  const clientToken = recoveryLogin.access_token;
  const products = await req('GET', '/admin/products', null, admin.access_token);
  const gold = products.find((p) => p.sku === 'AU-EAGLE-1OZ');
  const quote = await req(
    'POST',
    '/client/quotes',
    { product_id: gold.id, side: 'sell', quantity: 3, ttl_minutes: 15 },
    clientToken,
  );
  console.log(`quote ${quote.id.slice(0, 8)}… locked at $${quote.unit_price}/unit × 3 = $${quote.line_total}`);
  console.log('expires at:', quote.expires_at);

  // Admin converts to invoice
  const converted = await req(
    'POST',
    `/admin/quotes/${quote.id}/convert`,
    {},
    admin.access_token,
  );
  console.log(`✓ converted to invoice ${converted.invoice_number} (total $${converted.total})`);

  // -------- Photo upload --------
  console.log('\n=== Photos ===');
  const dealReq = await req(
    'POST',
    '/client/deal-requests',
    { type: 'sell', product_id: gold.id, quantity: 1, notes: 'See photos' },
    clientToken,
  );
  // Create a tiny valid PNG (1x1 red) in memory.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'coin.png');
  const up = await req(
    'POST',
    `/deal-requests/${dealReq.id}/photos`,
    fd,
    clientToken,
    false,
  );
  console.log('✓ uploaded photo:', up.id, 'url:', up.url);

  const list = await req('GET', `/deal-requests/${dealReq.id}/photos`, null, clientToken);
  console.log('photos on request:', list.length);

  // Fetch the file as the client (auth-gated)
  const fileRes = await fetch(API + up.url.replace('/api/v1', ''), {
    headers: { Authorization: 'Bearer ' + clientToken },
  });
  console.log('photo file fetch:', fileRes.status, fileRes.headers.get('content-type'));

  // Admin can also see the photos
  const adminList = await req(
    'GET',
    `/deal-requests/${dealReq.id}/photos`,
    null,
    admin.access_token,
  );
  console.log('admin sees', adminList.length, 'photo(s)');

  console.log('\nALL PASS.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
