// Integration suite — exercises the live API at http://localhost:4000 and
// verifies invariants that cross the HTTP, service, and DB layers.
//
// PRECONDITIONS
//   * `pnpm db:up` + migrations applied + seed ran (default admin exists)
//   * `pnpm api:dev` is running on localhost:4000
//
// These tests create their own unique fixtures per run and do not assert on
// pre-existing state, so they can run repeatedly without a DB reset.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const API = process.env.API_BASE_URL ?? 'http://localhost:4000';

// Tokens obtained in beforeAll so every test has fresh auth.
let ADMIN_TOKEN = '';
let CLIENT_ID = '';
const TEST_PRODUCT_IDS: string[] = [];

async function req(method: string, path: string, body?: unknown, token = ADMIN_TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(`${API}/api/v1${path}`, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function inventoryFor(productId: string) {
  const all = await req('GET', '/admin/inventory');
  return (all as Array<Record<string, unknown>>).find((r) => r.product_id === productId) as
    | {
        quantity_on_hand: number;
        quantity_reserved: number;
        available: number;
      }
    | undefined;
}

async function makeTestProduct(overrides?: Partial<{ purity: number; weight: number }>) {
  const sku = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    .toUpperCase()
    .slice(0, 50);
  const p = await req('POST', '/admin/products', {
    sku,
    name: 'Integration Test Product',
    metal: 'silver',
    category: 'round',
    weight_troy_oz: overrides?.weight ?? 1.0,
    purity: overrides?.purity ?? 0.999,
    show_on_website: false,
  });
  TEST_PRODUCT_IDS.push(p.id);
  return p;
}

async function buyStock(productId: string, qty: number) {
  const inv = await req('POST', '/admin/invoices', {
    client_id: CLIENT_ID,
    type: 'buy',
    payment_method: 'cash',
    line_items: [{ product_id: productId, quantity: qty }],
  });
  await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'finalized' });
  await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'paid' });
  return inv;
}

beforeAll(async () => {
  const login = await req('POST', '/auth/login', {
    email: 'admin@agc.local',
    password: 'ChangeMe_Admin_123!',
  }, '');
  ADMIN_TOKEN = login.access_token;
  const clients = await req('GET', '/admin/clients');
  CLIENT_ID = (clients as Array<{ id: string }>)[0].id;
});

afterAll(async () => {
  // Hard-delete test products so they don't pollute the dev DB. Inventory
  // cascades via migration 012; invoices keep their snapshots (010).
  const conn = new pg.Client({
    connectionString:
      process.env.DATABASE_URL ??
      'postgres://agc:agc_dev_password@localhost:5432/agc_crm',
  });
  await conn.connect();
  if (TEST_PRODUCT_IDS.length > 0) {
    await conn.query('DELETE FROM products WHERE id = ANY($1)', [TEST_PRODUCT_IDS]);
  }
  await conn.end();
});

// ─── invoice snapshot fidelity ───────────────────────────────────────

describe('Invoice snapshot fidelity', () => {
  it('captures gross_weight, purity, and metal_content as three DISTINCT values', async () => {
    const product = await makeTestProduct({ weight: 1.0909, purity: 0.9167 });
    await buyStock(product.id, 3);

    const invoice = await req('POST', '/admin/invoices', {
      client_id: CLIENT_ID,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: product.id, quantity: 2 }],
    });

    const detail = await req('GET', `/admin/invoices/${invoice.id}`);
    const line = (detail as { line_items: Array<Record<string, string | number>> }).line_items[0];
    expect(Number(line.gross_weight_troy_oz)).toBeCloseTo(1.0909, 4);
    expect(Number(line.purity)).toBeCloseTo(0.9167, 4);
    expect(Number(line.metal_content_troy_oz)).toBeCloseTo(1.0909 * 0.9167, 5);
    expect(line.gross_weight_troy_oz).not.toBe(line.metal_content_troy_oz);
  });

  it('invoice survives product HARD-DELETE — totals + PDF unchanged', async () => {
    const product = await makeTestProduct({ weight: 1.0, purity: 0.999 });
    await buyStock(product.id, 2);
    const invoice = await req('POST', '/admin/invoices', {
      client_id: CLIENT_ID,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: product.id, quantity: 1 }],
    });
    const before = await req('GET', `/admin/invoices/${invoice.id}`);

    // Bypass soft-delete: rip the row out of the DB.
    const conn = new pg.Client({
      connectionString:
        process.env.DATABASE_URL ?? 'postgres://agc:agc_dev_password@localhost:5432/agc_crm',
    });
    await conn.connect();
    await conn.query('DELETE FROM products WHERE id = $1', [product.id]);
    await conn.end();
    // Remove from cleanup list — already gone.
    const idx = TEST_PRODUCT_IDS.indexOf(product.id);
    if (idx >= 0) TEST_PRODUCT_IDS.splice(idx, 1);

    const after = await req('GET', `/admin/invoices/${invoice.id}`);
    const beforeL = (before as { line_items: Array<Record<string, string>>; total: string }).line_items[0];
    const afterL = (after as { line_items: Array<Record<string, string>>; total: string }).line_items[0];
    expect((after as { total: string }).total).toBe((before as { total: string }).total);
    expect(afterL.gross_weight_troy_oz).toBe(beforeL.gross_weight_troy_oz);
    expect(afterL.purity).toBe(beforeL.purity);
    expect(afterL.metal_content_troy_oz).toBe(beforeL.metal_content_troy_oz);
    expect(afterL.unit_price).toBe(beforeL.unit_price);

    // PDF still renders
    const pdfRes = await fetch(`${API}/api/v1/admin/invoices/${invoice.id}/pdf`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(pdfRes.ok).toBe(true);
    const buf = new Uint8Array(await pdfRes.arrayBuffer());
    expect(buf[0]).toBe(0x25); // '%'
    expect(buf[1]).toBe(0x50); // 'P'
    expect(buf.length).toBeGreaterThan(1000);
  });
});

// ─── reservation lifecycle ───────────────────────────────────────────

describe('Inventory reservation workflow', () => {
  it('buy.paid adds stock', async () => {
    const product = await makeTestProduct();
    const before = await inventoryFor(product.id);
    await buyStock(product.id, 5);
    const after = await inventoryFor(product.id);
    expect(after!.quantity_on_hand).toBe((before?.quantity_on_hand ?? 0) + 5);
  });

  it('sell.finalized reserves without touching on_hand; sell.shipped consumes', async () => {
    const product = await makeTestProduct();
    await buyStock(product.id, 10);
    const snap0 = await inventoryFor(product.id);

    const inv = await req('POST', '/admin/invoices', {
      client_id: CLIENT_ID,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: product.id, quantity: 3 }],
    });

    // Draft: nothing reserved
    const draft = await inventoryFor(product.id);
    expect(draft!.quantity_reserved).toBe(snap0!.quantity_reserved);

    // Finalized: reserved += 3, on_hand unchanged
    await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'finalized' });
    const fin = await inventoryFor(product.id);
    expect(fin!.quantity_reserved).toBe(snap0!.quantity_reserved + 3);
    expect(fin!.quantity_on_hand).toBe(snap0!.quantity_on_hand);
    expect(fin!.available).toBe(fin!.quantity_on_hand - fin!.quantity_reserved);

    // Paid: no inventory change
    await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'paid' });
    const paid = await inventoryFor(product.id);
    expect(paid!.quantity_reserved).toBe(fin!.quantity_reserved);
    expect(paid!.quantity_on_hand).toBe(fin!.quantity_on_hand);

    // Shipped: reserved -= 3, on_hand -= 3
    await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'shipped' });
    const shipped = await inventoryFor(product.id);
    expect(shipped!.quantity_reserved).toBe(snap0!.quantity_reserved);
    expect(shipped!.quantity_on_hand).toBe(snap0!.quantity_on_hand - 3);
  });

  it('cancel releases reservation', async () => {
    const product = await makeTestProduct();
    await buyStock(product.id, 4);
    const snap0 = await inventoryFor(product.id);

    const inv = await req('POST', '/admin/invoices', {
      client_id: CLIENT_ID,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: product.id, quantity: 2 }],
    });
    await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'finalized' });
    expect((await inventoryFor(product.id))!.quantity_reserved).toBe(snap0!.quantity_reserved + 2);

    await req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'canceled' });
    const after = await inventoryFor(product.id);
    expect(after!.quantity_reserved).toBe(snap0!.quantity_reserved);
    expect(after!.quantity_on_hand).toBe(snap0!.quantity_on_hand);
  });

  it('oversell is rejected atomically at finalize', async () => {
    const product = await makeTestProduct();
    await buyStock(product.id, 2);
    const snap0 = await inventoryFor(product.id);

    const inv = await req('POST', '/admin/invoices', {
      client_id: CLIENT_ID,
      type: 'sell',
      payment_method: 'wire',
      line_items: [{ product_id: product.id, quantity: snap0!.quantity_on_hand + 1 }],
    });

    await expect(
      req('PATCH', `/admin/invoices/${inv.id}/status`, { status: 'finalized' }),
    ).rejects.toThrowError(/Cannot reserve more than is on hand|Insufficient/);

    // No movement: counters unchanged after the failure.
    const after = await inventoryFor(product.id);
    expect(after!.quantity_reserved).toBe(snap0!.quantity_reserved);
    expect(after!.quantity_on_hand).toBe(snap0!.quantity_on_hand);
  });
});

// ─── override authorization ──────────────────────────────────────────

describe('Admin override', () => {
  it('allows an admin to set a line item override price', async () => {
    const product = await makeTestProduct();
    await buyStock(product.id, 1);
    const inv = await req('POST', '/admin/invoices', {
      client_id: CLIENT_ID,
      type: 'sell',
      payment_method: 'wire',
      line_items: [
        { product_id: product.id, quantity: 1, override_unit_price: 12345.67, override_reason: 'test override' },
      ],
    });
    const detail = await req('GET', `/admin/invoices/${inv.id}`);
    const line = (detail as { line_items: Array<Record<string, unknown>> }).line_items[0];
    expect(line.is_overridden).toBe(true);
    expect(Number(line.unit_price)).toBe(12345.67);
  });
});

// ─── public feed filter ──────────────────────────────────────────────

describe('Public /what-we-pay feed', () => {
  it('only returns products flagged show_on_website=true', async () => {
    // Our test products have show_on_website=false, so they MUST NOT appear.
    const product = await makeTestProduct();
    const feedRes = await fetch(`${API}/api/v1/public/what-we-pay`);
    const feed = (await feedRes.json()) as { items: Array<{ product_id: string }> };
    expect(feed.items.find((i) => i.product_id === product.id)).toBeUndefined();
  });
});
