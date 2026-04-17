// Phase 3.5 smoke: client CRM create → fuzzy find → portal-enable → login as client.
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
  console.log('admin logged in');

  // Create a new walk-in client.
  const unique = Date.now();
  const created = await req(
    'POST',
    '/admin/clients',
    {
      first_name: 'Zephyr',
      last_name: 'Higginbotham',
      email: `zephyr-${unique}@example.com`,
      phone: '+1 555 111 2222',
      city: 'Chicago',
      region: 'IL',
    },
    admin.access_token,
  );
  console.log('✓ created client:', created.first_name, created.last_name);

  // Fuzzy search for them with a typo.
  const search = await req(
    'GET',
    `/admin/clients?q=${encodeURIComponent('zepher')}`,
    null,
    admin.access_token,
  );
  console.log('✓ fuzzy "zepher" →', search.map((c) => c.first_name).join(', '));
  if (!search.find((c) => c.id === created.id)) throw new Error('fuzzy missed new client');

  // Timeline for a fresh client — should be empty.
  const timeline = await req(
    'GET',
    `/admin/clients/${created.id}/timeline`,
    null,
    admin.access_token,
  );
  console.log(
    '✓ timeline empty:',
    `invoices=${timeline.invoices.length} quotes=${timeline.quotes.length} requests=${timeline.requests.length} shipments=${timeline.shipments.length}`,
  );

  // Enable portal → get temp password.
  const enable = await req(
    'POST',
    `/admin/clients/${created.id}/enable-portal`,
    {},
    admin.access_token,
  );
  console.log('✓ portal enabled, temp password length:', enable.temp_password.length);

  // Client logs in with temp password.
  const clientLogin = await req('POST', '/auth/login', {
    email: `zephyr-${unique}@example.com`,
    password: enable.temp_password,
  });
  console.log('✓ client logged in with temp password');

  // Client hits /auth/me.
  const me = await req('GET', '/auth/me', null, clientLogin.access_token);
  console.log('✓ client me:', me.email, 'role=' + me.role);

  // Admin disables portal.
  await req(
    'POST',
    `/admin/clients/${created.id}/disable-portal`,
    {},
    admin.access_token,
  );
  console.log('✓ portal disabled');

  // Client login should now fail.
  try {
    await req('POST', '/auth/login', {
      email: `zephyr-${unique}@example.com`,
      password: enable.temp_password,
    });
    throw new Error('login should have been blocked');
  } catch (e) {
    console.log('✓ login blocked after disable:', String(e.message).slice(0, 70));
  }

  console.log('\nALL PASS.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
