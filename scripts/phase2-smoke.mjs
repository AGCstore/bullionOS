// Phase 2 end-to-end smoke test.
// Runs against a live API at localhost:4000.

const API = 'http://localhost:4000/api/v1';

async function post(path, body, token) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST ${path} ${r.status}: ${text}`);
  return JSON.parse(text);
}
async function get(path, token) {
  const r = await fetch(API + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  // Admin login
  const admin = await post('/auth/login', {
    email: 'admin@agc.local',
    password: 'ChangeMe_Admin_123!',
  });
  console.log('admin logged in');

  // Register a fresh client
  const email = `e2e-${Date.now()}@agc.local`;
  const reg = await post('/auth/register', {
    email,
    password: 'TestPass12345!',
    first_name: 'End',
    last_name: 'ToEnd',
  });
  console.log('client registered:', email);
  const clientToken = reg.tokens.access_token;

  // Resolve the client record
  const clients = await get(`/admin/clients?q=${encodeURIComponent(email)}`, admin.access_token);
  const clientId = clients[0].id;
  console.log('client_id:', clientId);

  // Client creates a deal request
  const products = await get('/admin/products', admin.access_token);
  const silverEagle = products.find((p) => p.sku === 'AG-EAGLE-1OZ');
  const goldEagle = products.find((p) => p.sku === 'AU-EAGLE-1OZ');

  const dealReq = await post(
    '/client/deal-requests',
    {
      type: 'sell',
      product_id: silverEagle.id,
      quantity: 50,
      notes: 'Got these from an estate sale.',
    },
    clientToken,
  );
  console.log('deal request created:', dealReq.id, 'status:', dealReq.status);

  // Admin accepts it
  const accepted = await fetch(API + `/admin/deal-requests/${dealReq.id}/respond`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + admin.access_token,
    },
    body: JSON.stringify({
      decision: 'accepted',
      message: 'Bring them by any time — we pay current spot less 10%.',
    }),
  }).then((r) => r.json());
  console.log('admin responded:', accepted.status, 'at', accepted.responded_at);

  // Admin creates an invoice for the client
  const invoice = await post(
    '/admin/invoices',
    {
      client_id: clientId,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: goldEagle.id, quantity: 2 }],
    },
    admin.access_token,
  );
  console.log('invoice created:', invoice.invoice_number, 'total $' + Number(invoice.total).toFixed(2));

  // Client sees their invoice
  const clientInvoices = await get('/client/invoices', clientToken);
  console.log('client sees', clientInvoices.length, 'invoice(s)');

  // Admin creates a shipment
  const shipment = await post(
    '/admin/shipments',
    {
      invoice_id: invoice.id,
      carrier: 'ups',
      tracking_number: '1Z999AA10123456784',
    },
    admin.access_token,
  );
  console.log('shipment created:', shipment.id, 'status:', shipment.status);

  // Admin updates shipment to in_transit
  const updated = await fetch(API + `/admin/shipments/${shipment.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + admin.access_token,
    },
    body: JSON.stringify({ status: 'in_transit' }),
  }).then((r) => r.json());
  console.log('shipment advanced:', updated.status, 'shipped_at:', updated.shipped_at);

  // Client sees shipment w/ tracking URL
  const clientShipments = await get('/client/shipments', clientToken);
  for (const s of clientShipments) {
    console.log('client shipment:', s.carrier, s.tracking_number, '→', s.tracking_url);
  }

  // Client notification feed
  const notifs = await get('/me/notifications', clientToken);
  console.log('\nclient has', notifs.length, 'notifications:');
  for (const n of notifs) console.log('  -', n.type, '|', n.title);

  const unread = await get('/me/notifications/unread-count', clientToken);
  console.log('unread count:', unread.count);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
