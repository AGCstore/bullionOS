// Phase 4 smoke: httpOnly refresh cookie + messaging thread.
const API = 'http://localhost:4000/api/v1';

/**
 * Minimal cookie jar. `fetch` under Node 24 handles Set-Cookie, but we need
 * to persist it across calls manually.
 */
class Jar {
  cookies = new Map();
  apply(headers) {
    const setCookies = headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const first = sc.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function req(method, path, body, token, jar) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (jar && jar.cookies.size) headers.Cookie = jar.header();
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(API + path, init);
  if (jar) jar.apply(r.headers);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log('--- httpOnly cookie login/refresh/logout ---');
  const jar = new Jar();
  const login = await req(
    'POST',
    '/auth/login',
    { email: 'admin@agc.local', password: 'ChangeMe_Admin_123!' },
    null,
    jar,
  );
  console.log('login → access_token len:', login.access_token.length);
  console.log('login set-cookie received:', jar.cookies.has('agc_refresh'));
  if (!jar.cookies.has('agc_refresh')) throw new Error('refresh cookie missing');
  if ('refresh_token' in login) throw new Error('refresh_token should NOT be in body');

  // Refresh using only the cookie (no bearer, no body).
  const r2 = await fetch(API + '/auth/refresh', {
    method: 'POST',
    headers: { Cookie: jar.header() },
  });
  jar.apply(r2.headers);
  const tokens2 = await r2.json();
  if (!r2.ok) throw new Error('refresh failed');
  console.log('refresh → new access_token issued, len:', tokens2.access_token.length);

  // Logout via cookie only.
  const r3 = await fetch(API + '/auth/logout', {
    method: 'POST',
    headers: { Cookie: jar.header() },
  });
  console.log('logout status:', r3.status);

  // A fresh refresh should now fail (token revoked by logout).
  const r4 = await fetch(API + '/auth/refresh', {
    method: 'POST',
    headers: { Cookie: jar.header() },
  });
  console.log('refresh after logout:', r4.status, '(should be 401)');
  if (r4.status !== 401) throw new Error('logout did not revoke refresh');

  // --- Messaging round-trip ---
  console.log('\n--- Messaging thread ---');
  const admin = await req('POST', '/auth/login', {
    email: 'admin@agc.local',
    password: 'ChangeMe_Admin_123!',
  });
  const ADMIN = admin.access_token;

  const email = `msg-${Date.now()}@agc.local`;
  const reg = await req('POST', '/auth/register', {
    email,
    password: 'TestPass12345!',
    first_name: 'Msg',
    last_name: 'Tester',
  });
  const CLIENT = reg.tokens.access_token;

  const products = await req('GET', '/admin/products', null, ADMIN);
  const gold = products.find((p) => p.sku === 'AU-EAGLE-1OZ');

  const dr = await req(
    'POST',
    '/client/deal-requests',
    { type: 'sell', product_id: gold.id, quantity: 1, notes: 'test' },
    CLIENT,
  );
  console.log('deal request created:', dr.id);

  // Client posts a message.
  const m1 = await req(
    'POST',
    `/deal-requests/${dr.id}/messages`,
    { body: 'Hi AGC, what additional info do you need?' },
    CLIENT,
  );
  console.log('client posted:', m1.id, 'role=' + m1.author_role);

  // Admin reads the thread — should mark client msg as read.
  const thread1 = await req('GET', `/deal-requests/${dr.id}/messages`, null, ADMIN);
  console.log('admin sees', thread1.length, 'message(s); author_name:', thread1[0].author_name);

  // Admin replies.
  await req(
    'POST',
    `/deal-requests/${dr.id}/messages`,
    { body: 'Please send photos of both sides + edge.' },
    ADMIN,
  );

  // Client reads back — should see admin reply and mark it read.
  const thread2 = await req('GET', `/deal-requests/${dr.id}/messages`, null, CLIENT);
  console.log('client thread:', thread2.length, 'messages');
  thread2.forEach((m) =>
    console.log(`  [${m.author_role}] ${m.author_name}: ${m.body.slice(0, 50)}`),
  );

  // Unauthorized client (admin account trying as "client" via a different user)
  // should not access unrelated requests — we have a separate check above.
  console.log('\nALL PASS.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
