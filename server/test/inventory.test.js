import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, pool, onHand, doOp } from './helpers.js';

let ctx;
before(async () => { ctx = await setup(); });
after(() => pool.end());

const totalOnHand = async (productId) =>
  Number((await pool.query(`SELECT COALESCE(SUM(q.quantity),0) s FROM stock_quants q JOIN locations l ON l.id=q.location_id
                             WHERE q.product_id=$1 AND l.type='internal'`, [productId])).rows[0].s);

test('the PDF example: receive 100, transfer, deliver 20, adjust -3 => 77, fully logged', async () => {
  const { m, wh, stock, rack, steel } = ctx;

  const receipt = await doOp(m, 'receipt', { warehouse_id: wh.id, partner: 'Vendor', lines: [{ product_id: steel.id, quantity: 100 }] });
  assert.equal(receipt.reference, 'WH/IN/0001');
  assert.equal(receipt.status, 'done');
  assert.equal(await totalOnHand(steel.id), 100);

  await doOp(m, 'internal', { source_location_id: stock.id, dest_location_id: rack.id, lines: [{ product_id: steel.id, quantity: 100 }] });
  assert.equal(await totalOnHand(steel.id), 100, 'transfers never change the total');
  assert.equal(await onHand(steel.id, rack.id), 100);
  assert.equal(await onHand(steel.id, stock.id), 0);

  await doOp(m, 'delivery', { source_location_id: rack.id, partner: 'Customer', lines: [{ product_id: steel.id, quantity: 20 }] });
  assert.equal(await totalOnHand(steel.id), 80);

  // Adjustment records the COUNTED quantity: 77 counted where 80 recorded => -3
  const adj = await doOp(m, 'adjustment', { source_location_id: rack.id, notes: 'Damaged', lines: [{ product_id: steel.id, quantity: 77 }] });
  assert.equal(adj.lines[0].system_qty, 80);
  assert.equal(adj.moves[0].quantity, 3);
  assert.equal(await totalOnHand(steel.id), 77);

  const ledger = (await m.get(`/api/moves?product_id=${steel.id}`).expect(200)).body.items.reverse();
  assert.equal(ledger.length, 4);
  assert.deepEqual(ledger.map((x) => x.balance), [100, 100, 80, 77]);
  assert.deepEqual(ledger.map((x) => x.delta), [100, 0, -20, -3]);
});

test('delivery without enough stock: Waiting, validation fails atomically', async () => {
  const { m, wh, stock, steel, chair } = ctx;
  await doOp(m, 'receipt', { warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: 5 }] });
  const steelBefore = await onHand(steel.id, stock.id);

  const op = (await m.post('/api/operations').send({
    type: 'delivery', warehouse_id: wh.id,
    lines: [{ product_id: chair.id, quantity: 3 }, { product_id: steel.id, quantity: 9999 }],
  }).expect(201)).body;
  const confirmed = (await m.post(`/api/operations/${op.id}/confirm`).expect(200)).body;
  assert.equal(confirmed.status, 'waiting');

  const res = await m.post(`/api/operations/${op.id}/validate`).expect(409);
  assert.match(res.body.error, /Not enough stock/);
  assert.equal(res.body.fields.shortages[0].sku, 'STEEL');
  // the chair line had enough stock but must NOT have moved: all or nothing
  assert.equal(await onHand(chair.id, stock.id), 5);
  assert.equal(await onHand(steel.id, stock.id), steelBefore);
});

test('Waiting flips to Ready automatically when the stock arrives', async () => {
  const { m, wh, chair } = ctx;
  const op = (await m.post('/api/operations').send({ type: 'delivery', warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: 20 }] }).expect(201)).body;
  assert.equal((await m.post(`/api/operations/${op.id}/confirm`).expect(200)).body.status, 'waiting');
  await doOp(m, 'receipt', { warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: 50 }] });
  assert.equal((await m.get(`/api/operations/${op.id}`).expect(200)).body.status, 'ready');
});

test('validating twice never double counts', async () => {
  const { m, wh, stock, chair } = ctx;
  const before = await onHand(chair.id, stock.id);
  const op = await doOp(m, 'receipt', { warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: 10 }] });
  await m.post(`/api/operations/${op.id}/validate`).expect(409);
  assert.equal(await onHand(chair.id, stock.id), before + 10);
});

test('concurrent double-click on Validate applies the receipt once', async () => {
  const { m, wh, stock, chair } = ctx;
  const before = await onHand(chair.id, stock.id);
  const op = (await m.post('/api/operations').send({ type: 'receipt', warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: 7 }] }).expect(201)).body;
  const results = await Promise.all([1, 2, 3].map(() => m.post(`/api/operations/${op.id}/validate`)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(await onHand(chair.id, stock.id), before + 7);
});

test('two deliveries racing for the same stock cannot oversell', async () => {
  const { m, wh, stock } = ctx;
  const p = (await m.post('/api/products').send({ name: 'Desk', sku: 'DESK', uom: 'Units', initial_stock: 100, initial_location_id: stock.id }).expect(201)).body;
  const make = async () => (await m.post('/api/operations').send({ type: 'delivery', warehouse_id: wh.id, lines: [{ product_id: p.id, quantity: 60 }] }).expect(201)).body;
  const [a, b] = [await make(), await make()];
  const results = await Promise.all([a, b].map((op) => m.post(`/api/operations/${op.id}/validate`)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await onHand(p.id, stock.id), 40);
});

test('initial stock goes through the ledger', async () => {
  const { m } = ctx;
  const desk = (await m.get('/api/products?search=DESK').expect(200)).body.items[0];
  const moves = (await m.get(`/api/moves?product_id=${desk.id}`).expect(200)).body.items;
  assert.equal(moves.at(-1).operation_type, 'adjustment');
  assert.equal(moves.at(-1).quantity, 100);
});

test('returns reverse a validated delivery; done operations are locked', async () => {
  const { m, wh, stock, chair } = ctx;
  const before = await onHand(chair.id, stock.id);
  const out = await doOp(m, 'delivery', { warehouse_id: wh.id, partner: 'Acme', lines: [{ product_id: chair.id, quantity: 4 }] });
  assert.equal(await onHand(chair.id, stock.id), before - 4);

  await m.put(`/api/operations/${out.id}`).send({ lines: [{ product_id: chair.id, quantity: 1 }] }).expect(409);
  await m.post(`/api/operations/${out.id}/cancel`).expect(409);
  await m.del(`/api/operations/${out.id}`).expect(409);

  const ret = (await m.post(`/api/operations/${out.id}/return`).expect(201)).body;
  assert.equal(ret.type, 'receipt');
  assert.equal(ret.return_of_reference, out.reference);
  await m.post(`/api/operations/${ret.id}/validate`).expect(200);
  assert.equal(await onHand(chair.id, stock.id), before);
});

test('the ledger is append-only at the database level', async () => {
  await assert.rejects(pool.query('UPDATE stock_moves SET quantity = 1'), /append-only/);
  await assert.rejects(pool.query('DELETE FROM stock_moves'), /append-only/);
});

test('warehouse staff cannot manage products or apply adjustments', async () => {
  const { s, stock, chair } = ctx;
  await s.post('/api/products').send({ name: 'Hack', sku: 'HACK', uom: 'Units' }).expect(403);
  const adj = (await s.post('/api/operations').send({ type: 'adjustment', source_location_id: stock.id, lines: [{ product_id: chair.id, quantity: 0 }] }).expect(201)).body;
  const res = await s.post(`/api/operations/${adj.id}/validate`).expect(403);
  assert.match(res.body.error, /Inventory Managers/);
});

test('replenishment orders up to max, counting stock already incoming', async () => {
  const { m, wh, stock } = ctx;
  const bolt = (await m.post('/api/products').send({ name: 'Bolt', sku: 'BOLT', uom: 'Box', initial_stock: 5, initial_location_id: stock.id }).expect(201)).body;
  await m.post('/api/reorder-rules').send({ product_id: bolt.id, warehouse_id: wh.id, min_qty: 10, max_qty: 50 }).expect(201);
  const first = (await m.post('/api/replenish').send({ items: [{ product_id: bolt.id, warehouse_id: wh.id }] }).expect(201)).body.created;
  assert.equal(first.length, 1);
  const op = (await m.get(`/api/operations/${first[0].id}`).expect(200)).body;
  assert.equal(op.lines[0].quantity, 45);
  const second = (await m.post('/api/replenish').send({ items: [{ product_id: bolt.id, warehouse_id: wh.id }] }).expect(201)).body.created;
  assert.equal(second.length, 0, 'no duplicate order while one is incoming');
});

test('validation: SKU unique regardless of case, quantities must be positive', async () => {
  const { m, wh, chair } = ctx;
  const dup = await m.post('/api/products').send({ name: 'Chair 2', sku: 'chair', uom: 'Units' }).expect(409);
  assert.ok(dup.body.fields.sku);
  const neg = await m.post('/api/operations').send({ type: 'receipt', warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: -5 }] }).expect(400);
  assert.ok(neg.body.fields['lines.0.quantity']);
  const zero = await m.post('/api/operations').send({ type: 'receipt', warehouse_id: wh.id, lines: [{ product_id: chair.id, quantity: 0 }] }).expect(400);
  assert.ok(zero.body.fields['lines.0.quantity']);
});

test('dashboard KPIs reflect live data', async () => {
  const { m } = ctx;
  const d = (await m.get('/api/dashboard').expect(200)).body;
  assert.ok(d.kpis.in_stock >= 3);
  assert.equal(typeof d.kpis.pending_receipts, 'number');
  assert.ok(d.kpis.pending_deliveries >= 1);
  assert.ok(Array.isArray(d.low_stock));
});
