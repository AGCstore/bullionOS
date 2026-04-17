// Phase 3.6 smoke: inventory auto-applied on invoice status transitions.
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

  const products = await req('GET', '/admin/products', null, TOKEN);
  const gold = products.find((p) => p.sku === 'AU-EAGLE-1OZ');

  const inv0 = await req('GET', '/admin/inventory', null, TOKEN);
  const row0 = inv0.find((r) => r.product_id === gold.id);
  console.log(`gold eagle on hand (start): ${row0.quantity_on_hand}`);

  // Get a walk-in client.
  const clients = await req('GET', '/admin/clients', null, TOKEN);
  const client = clients[0];

  // ---------- BUY invoice → paid should INCREASE stock ----------
  console.log('\n--- BUY invoice flow ---');
  const buyInv = await req(
    'POST',
    '/admin/invoices',
    {
      client_id: client.id,
      type: 'buy',
      payment_method: 'cash',
      line_items: [{ product_id: gold.id, quantity: 5 }],
    },
    TOKEN,
  );
  console.log('buy invoice', buyInv.invoice_number, 'created');

  await req('PATCH', `/admin/invoices/${buyInv.id}/status`, { status: 'finalized' }, TOKEN);
  await req('PATCH', `/admin/invoices/${buyInv.id}/status`, { status: 'paid' }, TOKEN);
  console.log('buy invoice marked PAID');

  const inv1 = await req('GET', '/admin/inventory', null, TOKEN);
  const row1 = inv1.find((r) => r.product_id === gold.id);
  console.log(`gold eagle on hand (after buy.paid): ${row1.quantity_on_hand} (expected ${row0.quantity_on_hand + 5})`);
  if (row1.quantity_on_hand !== row0.quantity_on_hand + 5)
    throw new Error(`buy did not apply: ${row0.quantity_on_hand} -> ${row1.quantity_on_hand}`);

  // ---------- SELL invoice → shipped should DECREASE stock ----------
  console.log('\n--- SELL invoice flow ---');
  const sellInv = await req(
    'POST',
    '/admin/invoices',
    {
      client_id: client.id,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: gold.id, quantity: 2 }],
    },
    TOKEN,
  );
  console.log('sell invoice', sellInv.invoice_number, 'created');

  await req('PATCH', `/admin/invoices/${sellInv.id}/status`, { status: 'finalized' }, TOKEN);
  await req('PATCH', `/admin/invoices/${sellInv.id}/status`, { status: 'paid' }, TOKEN);
  // Sell→paid alone should NOT change inventory.
  const inv2 = await req('GET', '/admin/inventory', null, TOKEN);
  const row2 = inv2.find((r) => r.product_id === gold.id);
  console.log(`gold eagle after sell.paid (should match): ${row2.quantity_on_hand}`);
  if (row2.quantity_on_hand !== row1.quantity_on_hand)
    throw new Error('sell.paid should NOT affect inventory (only sell.shipped does)');

  await req('PATCH', `/admin/invoices/${sellInv.id}/status`, { status: 'shipped' }, TOKEN);
  console.log('sell invoice marked SHIPPED');

  const inv3 = await req('GET', '/admin/inventory', null, TOKEN);
  const row3 = inv3.find((r) => r.product_id === gold.id);
  console.log(`gold eagle after sell.shipped: ${row3.quantity_on_hand} (expected ${row1.quantity_on_hand - 2})`);
  if (row3.quantity_on_hand !== row1.quantity_on_hand - 2)
    throw new Error(`sell did not apply: ${row1.quantity_on_hand} -> ${row3.quantity_on_hand}`);

  // ---------- Public in-stock should list gold eagle ----------
  console.log('\n--- Public /public/in-stock ---');
  const publicList = await fetch(API + '/public/in-stock').then((r) => r.json());
  const pubRow = publicList.find((r) => r.product_id === gold.id);
  console.log(`public in-stock count: ${publicList.length}`);
  if (!pubRow) throw new Error('public in-stock missing gold eagle');
  console.log(`  gold eagle available: ${pubRow.available}`);

  // ---------- Manual adjustment ----------
  console.log('\n--- Manual adjustment ---');
  const after = await req(
    'PATCH',
    `/admin/inventory/${gold.id}`,
    { delta: -1, notes: 'found damaged coin' },
    TOKEN,
  );
  console.log(`after manual -1: ${after.quantity_on_hand} (expected ${row3.quantity_on_hand - 1})`);
  if (after.quantity_on_hand !== row3.quantity_on_hand - 1)
    throw new Error('manual adjust failed');

  console.log('\nALL PASS.');
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
