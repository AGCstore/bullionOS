// Reservation workflow smoke.
// Covers: reserve on finalize, release on cancel, consume on ship,
//         product deletion preserves invoice history, oversell blocked.
import pg from 'pg';
const API = 'http://localhost:4000/api/v1';
const DB_URL = 'postgres://agc:agc_dev_password@localhost:5432/agc_crm';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

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

async function getInventoryFor(productId, TOKEN) {
  const inv = await req('GET', '/admin/inventory', null, TOKEN);
  return inv.find((r) => r.product_id === productId);
}

async function main() {
  const admin = await req('POST', '/auth/login', {
    email: 'admin@agc.local',
    password: 'ChangeMe_Admin_123!',
  });
  const TOKEN = admin.access_token;

  const products = await req('GET', '/admin/products', null, TOKEN);
  const silver = products.find((p) => p.sku === 'AG-EAGLE-1OZ');

  const clients = await req('GET', '/admin/clients', null, TOKEN);
  const client = clients[0];

  // ─── Set up: ensure we have 10 silver eagles on hand via a BUY invoice ───
  console.log('--- prep: buy 10 silver eagles ---');
  const buy = await req('POST', '/admin/invoices', {
    client_id: client.id, type: 'buy', payment_method: 'cash',
    line_items: [{ product_id: silver.id, quantity: 10 }],
  }, TOKEN);
  await req('PATCH', `/admin/invoices/${buy.id}/status`, { status: 'finalized' }, TOKEN);
  await req('PATCH', `/admin/invoices/${buy.id}/status`, { status: 'paid' }, TOKEN);
  const inv0 = await getInventoryFor(silver.id, TOKEN);
  console.log(`  on_hand=${inv0.quantity_on_hand} reserved=${inv0.quantity_reserved} avail=${inv0.available}`);

  // ─── Test 1: reserve on finalize ────────────────────────────────────────
  console.log('\n--- test 1: reserve on sell.finalized ---');
  const sell1 = await req('POST', '/admin/invoices', {
    client_id: client.id, type: 'sell', payment_method: 'wire',
    line_items: [{ product_id: silver.id, quantity: 3 }],
  }, TOKEN);
  // Draft: nothing reserved yet
  let inv = await getInventoryFor(silver.id, TOKEN);
  assert(inv.quantity_reserved === inv0.quantity_reserved, `draft should not reserve (was ${inv.quantity_reserved})`);
  console.log(`  draft: on_hand=${inv.quantity_on_hand} reserved=${inv.quantity_reserved}`);

  await req('PATCH', `/admin/invoices/${sell1.id}/status`, { status: 'finalized' }, TOKEN);
  inv = await getInventoryFor(silver.id, TOKEN);
  assert(inv.quantity_reserved === inv0.quantity_reserved + 3, `finalize should reserve 3 (reserved=${inv.quantity_reserved})`);
  assert(inv.quantity_on_hand === inv0.quantity_on_hand, 'finalize must NOT change on_hand');
  assert(inv.available === inv.quantity_on_hand - inv.quantity_reserved, 'available math');
  console.log(`  finalized: on_hand=${inv.quantity_on_hand} reserved=${inv.quantity_reserved} avail=${inv.available} ✓`);

  // ─── Test 2: release on cancel from finalized ──────────────────────────
  console.log('\n--- test 2: release on cancel ---');
  await req('PATCH', `/admin/invoices/${sell1.id}/status`, { status: 'canceled' }, TOKEN);
  inv = await getInventoryFor(silver.id, TOKEN);
  assert(inv.quantity_reserved === inv0.quantity_reserved, `cancel should release (reserved=${inv.quantity_reserved})`);
  console.log(`  canceled: on_hand=${inv.quantity_on_hand} reserved=${inv.quantity_reserved} ✓`);

  // ─── Test 3: consume on shipped ────────────────────────────────────────
  console.log('\n--- test 3: consume on sell.shipped ---');
  const sell2 = await req('POST', '/admin/invoices', {
    client_id: client.id, type: 'sell', payment_method: 'wire',
    line_items: [{ product_id: silver.id, quantity: 2 }],
  }, TOKEN);
  await req('PATCH', `/admin/invoices/${sell2.id}/status`, { status: 'finalized' }, TOKEN);
  await req('PATCH', `/admin/invoices/${sell2.id}/status`, { status: 'paid' }, TOKEN);
  let b = await getInventoryFor(silver.id, TOKEN);
  assert(b.quantity_reserved === inv0.quantity_reserved + 2, 'paid should keep reserved');
  await req('PATCH', `/admin/invoices/${sell2.id}/status`, { status: 'shipped' }, TOKEN);
  b = await getInventoryFor(silver.id, TOKEN);
  assert(b.quantity_on_hand === inv0.quantity_on_hand - 2, 'ship should decrement on_hand by 2');
  assert(b.quantity_reserved === inv0.quantity_reserved, 'ship should clear the reservation');
  console.log(`  shipped: on_hand=${b.quantity_on_hand} reserved=${b.quantity_reserved} (was ${inv0.quantity_on_hand}/${inv0.quantity_reserved}) ✓`);

  // ─── Test 4: oversell refused atomically ───────────────────────────────
  console.log('\n--- test 4: oversell blocked ---');
  const overCount = b.quantity_on_hand + 1;
  const oversell = await req('POST', '/admin/invoices', {
    client_id: client.id, type: 'sell', payment_method: 'wire',
    line_items: [{ product_id: silver.id, quantity: overCount }],
  }, TOKEN);
  try {
    await req('PATCH', `/admin/invoices/${oversell.id}/status`, { status: 'finalized' }, TOKEN);
    throw new Error(`UNEXPECTED: finalize with qty ${overCount} > on_hand ${b.quantity_on_hand} succeeded`);
  } catch (e) {
    if (!String(e.message).includes('Cannot reserve more than is on hand')
        && !String(e.message).includes('Insufficient')) {
      throw e;
    }
    console.log(`  ✓ overSell rejected: ${String(e.message).slice(0, 80)}`);
  }

  // ─── Test 5: product deletion preserves invoice history ────────────────
  console.log('\n--- test 5: delete product → invoice reprints ---');
  // Use a FRESH product so we can safely delete it.
  const temp = await req('POST', '/admin/products', {
    sku: `TEMP-DEL-${Date.now()}`.slice(0, 50),
    name: 'Temporary Deletable',
    metal: 'silver', category: 'round',
    weight_troy_oz: 1.0, purity: 0.999,
    show_on_website: false,
  }, TOKEN);
  // Buy 5 so we can sell some later
  const tempBuy = await req('POST', '/admin/invoices', {
    client_id: client.id, type: 'buy', payment_method: 'cash',
    line_items: [{ product_id: temp.id, quantity: 5 }],
  }, TOKEN);
  await req('PATCH', `/admin/invoices/${tempBuy.id}/status`, { status: 'finalized' }, TOKEN);
  await req('PATCH', `/admin/invoices/${tempBuy.id}/status`, { status: 'paid' }, TOKEN);
  // Now sell 2, ship them
  const tempSell = await req('POST', '/admin/invoices', {
    client_id: client.id, type: 'sell', payment_method: 'wire',
    line_items: [{ product_id: temp.id, quantity: 2 }],
  }, TOKEN);
  await req('PATCH', `/admin/invoices/${tempSell.id}/status`, { status: 'finalized' }, TOKEN);
  await req('PATCH', `/admin/invoices/${tempSell.id}/status`, { status: 'paid' }, TOKEN);
  await req('PATCH', `/admin/invoices/${tempSell.id}/status`, { status: 'shipped' }, TOKEN);

  // Capture invoice total + snapshot BEFORE deletion
  const before = await req('GET', `/admin/invoices/${tempSell.id}`, null, TOKEN);
  const beforeLine = before.line_items[0];
  console.log(`  before delete: total=$${before.total}, gross=${beforeLine.gross_weight_troy_oz}, purity=${beforeLine.purity}, content=${beforeLine.metal_content_troy_oz}`);
  assert(Number(beforeLine.gross_weight_troy_oz) > 0, 'gross_weight must be > 0 (not blank)');
  assert(Number(beforeLine.purity) > 0 && Number(beforeLine.purity) <= 1, 'purity must be valid fraction');
  assert(beforeLine.gross_weight_troy_oz !== beforeLine.metal_content_troy_oz
         || Number(beforeLine.purity) === 1,
         'gross_weight should differ from metal_content when purity<1');

  // HARD-DELETE the product row (not just soft) using raw SQL to simulate the nightmare case.
  const pg1 = new pg.Client({ connectionString: DB_URL });
  await pg1.connect();
  await pg1.query('DELETE FROM products WHERE id = $1', [temp.id]);
  const stillExists = await pg1.query('SELECT id FROM products WHERE id = $1', [temp.id]);
  await pg1.end();
  assert(stillExists.rows.length === 0, 'product should be hard-deleted');
  console.log(`  product ${temp.id.slice(0, 8)}… deleted from DB`);

  // Re-read the invoice.
  const after = await req('GET', `/admin/invoices/${tempSell.id}`, null, TOKEN);
  const afterLine = after.line_items[0];
  assert(after.total === before.total, `total changed: ${before.total} → ${after.total}`);
  assert(afterLine.product_name_snapshot === beforeLine.product_name_snapshot, 'product name snapshot changed');
  assert(afterLine.gross_weight_troy_oz === beforeLine.gross_weight_troy_oz, 'gross_weight changed');
  assert(afterLine.purity === beforeLine.purity, 'purity changed');
  assert(afterLine.metal_content_troy_oz === beforeLine.metal_content_troy_oz, 'metal_content changed');
  assert(afterLine.unit_price === beforeLine.unit_price, 'unit_price changed');
  assert(afterLine.line_total === beforeLine.line_total, 'line_total changed');
  console.log(`  after delete: total=$${after.total} (UNCHANGED) ✓`);

  // The PDF endpoint must still render.
  const pdfRes = await fetch(API + `/admin/invoices/${tempSell.id}/pdf`, { headers: { Authorization: 'Bearer ' + TOKEN } });
  assert(pdfRes.ok, `PDF fetch failed: ${pdfRes.status}`);
  const bytes = new Uint8Array(await pdfRes.arrayBuffer());
  assert(bytes[0] === 0x25 && bytes[1] === 0x50, 'PDF magic bytes (%P) missing');
  console.log(`  PDF re-rendered: ${bytes.length} bytes, starts with %PDF ✓`);

  console.log('\nALL PASS.');
}

main().catch((e) => {
  console.error('FAIL:', e.stack ?? e.message);
  process.exit(1);
});
