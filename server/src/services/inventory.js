// ============================================================================
//  StockSense stock engine
//  The ONLY place in the codebase that changes stock. Every change:
//    1. happens inside one DB transaction,
//    2. locks the rows it touches (SELECT ... FOR UPDATE) so concurrent
//       validations can never oversell,
//    3. appends to the immutable stock_moves ledger AND updates the
//       stock_quants cache together, so they can never disagree.
// ============================================================================
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';

export const PREFIX = { receipt: 'IN', delivery: 'OUT', internal: 'INT', adjustment: 'ADJ' };
const OPEN_STATUSES = ['draft', 'waiting', 'ready'];

// ---------------------------------------------------------------- helpers
async function virtualLocation(client, type) {
  const { rows } = await client.query('SELECT id FROM locations WHERE type = $1', [type]);
  if (!rows[0]) throw new Error(`Virtual location "${type}" is missing. Run npm run db:seed.`);
  return rows[0].id;
}

async function getLocation(client, locationId) {
  const { rows } = await client.query('SELECT * FROM locations WHERE id = $1', [locationId]);
  if (!rows[0]) throw badRequest('Location not found', { location: 'Choose an existing location' });
  if (!rows[0].active) throw badRequest('This location is archived', { location: 'Choose an active location' });
  return rows[0];
}

async function defaultStockLocation(client, warehouseId) {
  const { rows } = await client.query(
    `SELECT id FROM locations WHERE warehouse_id = $1 AND is_default AND active`, [warehouseId]);
  if (!rows[0]) throw badRequest('This warehouse has no default stock location');
  return rows[0].id;
}

/** WH/IN/0001, WH/OUT/0002 ... gap-free per warehouse and type (row-locked counter). */
export async function nextReference(client, warehouseId, type) {
  const { rows } = await client.query(
    `INSERT INTO operation_sequences (warehouse_id, type, last_value) VALUES ($1, $2, 1)
     ON CONFLICT (warehouse_id, type) DO UPDATE SET last_value = operation_sequences.last_value + 1
     RETURNING last_value, (SELECT code FROM warehouses WHERE id = $1) AS code`,
    [warehouseId, type]);
  const { last_value, code } = rows[0];
  return `${code}/${PREFIX[type]}/${String(last_value).padStart(4, '0')}`;
}

/** Quantity on hand at one location. Pass lock=true inside a transaction to lock the row. */
async function onHand(client, productId, locationId, lock = false) {
  const { rows } = await client.query(
    `SELECT quantity FROM stock_quants WHERE product_id = $1 AND location_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [productId, locationId]);
  return rows[0]?.quantity ?? 0;
}

async function addToQuant(client, productId, locationId, delta) {
  // CHECK (quantity >= 0) on stock_quants is the last line of defence against negative stock
  if (delta < 0) {
    // Removing stock: the row must exist (callers lock + check it first)
    const { rowCount } = await client.query(
      `UPDATE stock_quants SET quantity = quantity + $3, updated_at = now()
        WHERE product_id = $1 AND location_id = $2`, [productId, locationId, delta]);
    if (!rowCount) throw conflict('Not enough stock for this operation');
    return;
  }
  await client.query(
    `INSERT INTO stock_quants (product_id, location_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (product_id, location_id)
     DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity, updated_at = now()`,
    [productId, locationId, delta]);
}

async function writeMove(client, { operationId, productId, from, to, quantity, userId }) {
  await client.query(
    `INSERT INTO stock_moves (operation_id, product_id, from_location_id, to_location_id, quantity, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [operationId, productId, from, to, quantity, userId]);
}

async function loadOperation(client, operationId, lock = false) {
  const { rows } = await client.query(
    `SELECT * FROM operations WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [operationId]);
  if (!rows[0]) throw notFound('Operation');
  return rows[0];
}

async function loadLines(client, operationId) {
  const { rows } = await client.query(
    `SELECT l.*, p.name AS product_name, p.sku, p.uom
       FROM operation_lines l JOIN products p ON p.id = l.product_id
      WHERE l.operation_id = $1 ORDER BY l.product_id`, // fixed order => consistent lock order, no deadlocks
    [operationId]);
  return rows;
}

// ---------------------------------------------------------------- location rules
/**
 * Works out and checks source/destination for an operation type.
 * Returns { warehouseId, source, dest }.
 */
async function resolveLocations(client, type, { warehouse_id, source_location_id, dest_location_id }, { isReturn = false } = {}) {
  let source, dest;
  if (type === 'receipt') {
    source = source_location_id ?? (await virtualLocation(client, 'vendor'));
    dest = dest_location_id ?? (warehouse_id && (await defaultStockLocation(client, warehouse_id)));
  } else if (type === 'delivery') {
    source = source_location_id ?? (warehouse_id && (await defaultStockLocation(client, warehouse_id)));
    dest = dest_location_id ?? (await virtualLocation(client, 'customer'));
  } else if (type === 'internal') {
    source = source_location_id;
    dest = dest_location_id;
  } else {
    // adjustment: counts are recorded against ONE internal location
    source = dest = source_location_id ?? dest_location_id ?? (warehouse_id && (await defaultStockLocation(client, warehouse_id)));
  }
  if (!source) throw badRequest('Choose a source location', { source_location_id: 'Required' });
  if (!dest) throw badRequest('Choose a destination location', { dest_location_id: 'Required' });

  const src = await getLocation(client, source);
  const dst = await getLocation(client, dest);
  const externalOk = isReturn ? ['vendor', 'customer'] : null;

  const fail = (field, msg) => { throw badRequest(msg, { [field]: msg }); };
  if (type === 'receipt') {
    if (!(externalOk || ['vendor']).includes(src.type)) fail('source_location_id', 'Receipts come from the Vendors location');
    if (dst.type !== 'internal') fail('dest_location_id', 'Receipts go into a warehouse location');
  } else if (type === 'delivery') {
    if (src.type !== 'internal') fail('source_location_id', 'Deliveries leave from a warehouse location');
    if (!(externalOk || ['customer']).includes(dst.type)) fail('dest_location_id', 'Deliveries go to the Customers location');
  } else if (type === 'internal') {
    if (src.type !== 'internal') fail('source_location_id', 'Transfers start at a warehouse location');
    if (dst.type !== 'internal') fail('dest_location_id', 'Transfers end at a warehouse location');
    if (src.id === dst.id) fail('dest_location_id', 'Pick a different destination than the source');
  } else if (src.type !== 'internal') {
    fail('source_location_id', 'Count stock at a warehouse location');
  }

  const warehouseId = (type === 'receipt' ? dst : src).warehouse_id;
  return { warehouseId, source: src.id, dest: dst.id };
}

function checkLines(type, lines) {
  if (!lines?.length) throw badRequest('Add at least one product', { lines: 'Add at least one product' });
  const seen = new Set();
  lines.forEach((l, i) => {
    if (seen.has(l.product_id)) throw badRequest('Each product can appear only once', { [`lines.${i}.product_id`]: 'Duplicate product' });
    seen.add(l.product_id);
    if (type !== 'adjustment' && !(l.quantity > 0)) {
      throw badRequest('Quantities must be greater than zero', { [`lines.${i}.quantity`]: 'Must be greater than 0' });
    }
  });
}

async function replaceLines(client, operationId, lines) {
  await client.query('DELETE FROM operation_lines WHERE operation_id = $1', [operationId]);
  for (const l of lines) {
    const { rowCount } = await client.query('SELECT 1 FROM products WHERE id = $1 AND active', [l.product_id]);
    if (!rowCount) throw badRequest('One of the products is missing or archived', { lines: 'Pick active products' });
    await client.query(
      'INSERT INTO operation_lines (operation_id, product_id, quantity) VALUES ($1, $2, $3)',
      [operationId, l.product_id, l.quantity]);
  }
}

// ---------------------------------------------------------------- availability (Waiting vs Ready)
/** For moves out of a warehouse location: are all lines covered by current stock? */
export async function computeReadiness(client, op) {
  if (op.type === 'receipt' || op.type === 'adjustment') return { status: 'ready', shortages: [] };
  const lines = await loadLines(client, op.id);
  const shortages = [];
  for (const l of lines) {
    const available = await onHand(client, l.product_id, op.source_location_id);
    if (available < l.quantity) {
      shortages.push({ product_id: l.product_id, sku: l.sku, name: l.product_name, needed: l.quantity, available });
    }
  }
  return { status: shortages.length ? 'waiting' : 'ready', shortages };
}

/**
 * After stock changes, re-check open (waiting/ready) operations that touch
 * those products so "Waiting" flips to "Ready" by itself when goods arrive.
 */
async function refreshOpenOperations(client, productIds) {
  if (!productIds.length) return;
  const { rows } = await client.query(
    `SELECT DISTINCT o.* FROM operations o JOIN operation_lines l ON l.operation_id = o.id
      WHERE o.status IN ('waiting','ready') AND o.type IN ('delivery','internal') AND l.product_id = ANY($1)`,
    [productIds]);
  for (const op of rows) {
    const { status } = await computeReadiness(client, op);
    if (status !== op.status) {
      await client.query('UPDATE operations SET status = $2, updated_at = now() WHERE id = $1', [op.id, status]);
    }
  }
}

// ---------------------------------------------------------------- public API
export async function createOperation(client, type, data, user) {
  checkLines(type, data.lines);
  const loc = await resolveLocations(client, type, data);
  const reference = await nextReference(client, loc.warehouseId, type);
  const { rows } = await client.query(
    `INSERT INTO operations (reference, type, warehouse_id, source_location_id, dest_location_id,
                             partner, scheduled_date, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9) RETURNING *`,
    [reference, type, loc.warehouseId, loc.source, loc.dest, data.partner ?? null,
     data.scheduled_date ?? null, data.notes ?? null, user.id]);
  await replaceLines(client, rows[0].id, data.lines);
  return rows[0];
}

export async function updateOperation(client, operationId, data) {
  const op = await loadOperation(client, operationId, true);
  if (op.status !== 'draft') throw conflict('Only draft operations can be edited. Cancel or return it instead.');
  checkLines(op.type, data.lines);
  const loc = await resolveLocations(client, op.type, {
    warehouse_id: op.warehouse_id,
    source_location_id: data.source_location_id ?? op.source_location_id,
    dest_location_id: data.dest_location_id ?? op.dest_location_id,
  }, { isReturn: !!op.return_of_id });
  if (loc.warehouseId !== op.warehouse_id) {
    throw badRequest('Locations must stay in the same warehouse. Create a new operation instead.');
  }
  await client.query(
    `UPDATE operations SET source_location_id=$2, dest_location_id=$3, partner=$4,
            scheduled_date=COALESCE($5, scheduled_date), notes=$6, updated_at=now() WHERE id=$1`,
    [op.id, loc.source, loc.dest, data.partner ?? null, data.scheduled_date ?? null, data.notes ?? null]);
  await replaceLines(client, op.id, data.lines);
}

/** Draft -> Ready (stock available) or Waiting (not yet). Also used for "Check availability". */
export async function confirmOperation(client, operationId) {
  const op = await loadOperation(client, operationId, true);
  if (!OPEN_STATUSES.includes(op.status)) throw conflict(`This operation is already ${op.status}`);
  const result = await computeReadiness(client, op);
  await client.query('UPDATE operations SET status=$2, updated_at=now() WHERE id=$1', [op.id, result.status]);
  return result;
}

/**
 * Validate = actually move the stock. Atomic: all lines move, or none do.
 */
export async function validateOperation(client, operationId, user) {
  // Lock the operation row: a second concurrent "Validate" click waits here,
  // then sees status = 'done' and is rejected. No double counting.
  const op = await loadOperation(client, operationId, true);
  if (op.status === 'done') throw conflict('This operation has already been validated');
  if (op.status === 'canceled') throw conflict('Canceled operations cannot be validated');
  if (op.type === 'adjustment' && user.role !== 'manager') {
    throw forbidden('Only Inventory Managers can apply stock adjustments. Save the count and ask a manager to validate.');
  }

  const lines = await loadLines(client, op.id);
  if (!lines.length) throw badRequest('Add at least one product before validating');

  const shortages = [];
  const touched = [];
  const adjustmentLoc = op.type === 'adjustment' ? await virtualLocation(client, 'adjustment') : null;

  for (const line of lines) {
    const move = { operationId: op.id, productId: line.product_id, userId: user.id };

    if (op.type === 'receipt') {
      await addToQuant(client, line.product_id, op.dest_location_id, line.quantity);
      await writeMove(client, { ...move, from: op.source_location_id, to: op.dest_location_id, quantity: line.quantity });
    } else if (op.type === 'delivery' || op.type === 'internal') {
      const available = await onHand(client, line.product_id, op.source_location_id, true); // row lock
      if (available < line.quantity) {
        shortages.push({ product_id: line.product_id, sku: line.sku, name: line.product_name, needed: line.quantity, available });
        continue; // collect every shortage so the user sees them all at once
      }
      await addToQuant(client, line.product_id, op.source_location_id, -line.quantity);
      const dest = await getLocation(client, op.dest_location_id);
      if (dest.type === 'internal') await addToQuant(client, line.product_id, op.dest_location_id, line.quantity);
      await writeMove(client, { ...move, from: op.source_location_id, to: op.dest_location_id, quantity: line.quantity });
    } else {
      // adjustment: counted quantity vs system quantity
      await addToQuant(client, line.product_id, op.source_location_id, 0); // ensure row exists
      const system = await onHand(client, line.product_id, op.source_location_id, true);
      const diff = Math.round((line.quantity - system) * 1000) / 1000;
      await client.query('UPDATE operation_lines SET system_qty = $2 WHERE id = $1', [line.id, system]);
      if (diff !== 0) {
        await addToQuant(client, line.product_id, op.source_location_id, diff);
        await writeMove(client, diff > 0
          ? { ...move, from: adjustmentLoc, to: op.source_location_id, quantity: diff }
          : { ...move, from: op.source_location_id, to: adjustmentLoc, quantity: -diff });
      }
    }
    touched.push(line.product_id);
  }

  if (shortages.length) {
    // Throwing rolls back the whole transaction - nothing above is kept
    const list = shortages.map((s) => `${s.sku}: need ${s.needed}, have ${s.available}`).join('; ');
    const err = conflict(`Not enough stock at the source location (${list})`);
    err.fields = { shortages };
    throw err;
  }

  await client.query(
    `UPDATE operations SET status='done', validated_at=now(), validated_by=$2, updated_at=now() WHERE id=$1`,
    [op.id, user.id]);
  await refreshOpenOperations(client, touched);
}

export async function cancelOperation(client, operationId) {
  const op = await loadOperation(client, operationId, true);
  if (op.status === 'done') throw conflict('Validated operations cannot be canceled. Create a return instead.');
  if (op.status === 'canceled') throw conflict('This operation is already canceled');
  await client.query(`UPDATE operations SET status='canceled', updated_at=now() WHERE id=$1`, [op.id]);
}

/** Undo a validated receipt/delivery/transfer the correct way: a new, opposite operation. */
export async function createReturn(client, operationId, user) {
  const op = await loadOperation(client, operationId, true);
  if (op.status !== 'done') throw conflict('Only validated operations can be returned');
  if (op.type === 'adjustment') throw conflict('Adjustments are corrected with a new count, not a return');
  const lines = await loadLines(client, op.id);
  const type = { receipt: 'delivery', delivery: 'receipt', internal: 'internal' }[op.type];
  const loc = await resolveLocations(client, type,
    { source_location_id: op.dest_location_id, dest_location_id: op.source_location_id }, { isReturn: true });
  const reference = await nextReference(client, loc.warehouseId, type);
  const { rows } = await client.query(
    `INSERT INTO operations (reference, type, warehouse_id, source_location_id, dest_location_id,
                             partner, notes, return_of_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [reference, type, loc.warehouseId, loc.source, loc.dest, op.partner, `Return of ${op.reference}`, op.id, user.id]);
  await replaceLines(client, rows[0].id, lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })));
  return rows[0];
}

export async function deleteOperation(client, operationId) {
  const op = await loadOperation(client, operationId, true);
  if (!['draft', 'canceled'].includes(op.status)) throw conflict('Only draft or canceled operations can be deleted');
  await client.query('DELETE FROM operations WHERE id = $1', [op.id]);
}

/**
 * Create draft receipts to refill products below their reorder minimum,
 * up to the maximum. Incoming (open) receipts are counted so we don't double order.
 */
export async function replenish(client, items, user) {
  const created = [];
  const byWarehouse = new Map();
  for (const { product_id, warehouse_id } of items) {
    const { rows } = await client.query(
      `SELECT r.min_qty, r.max_qty,
              COALESCE((SELECT SUM(q.quantity) FROM stock_quants q JOIN locations l ON l.id = q.location_id
                         WHERE q.product_id = r.product_id AND l.warehouse_id = r.warehouse_id), 0) AS on_hand,
              COALESCE((SELECT SUM(ol.quantity) FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id
                         WHERE ol.product_id = r.product_id AND o.warehouse_id = r.warehouse_id
                           AND o.type = 'receipt' AND o.status IN ('draft','waiting','ready')), 0) AS incoming
         FROM reorder_rules r WHERE r.product_id = $1 AND r.warehouse_id = $2`,
      [product_id, warehouse_id]);
    const rule = rows[0];
    if (!rule) continue;
    const forecast = rule.on_hand + rule.incoming;
    if (forecast >= rule.max_qty || rule.on_hand > rule.min_qty) continue;
    const qty = Math.round((rule.max_qty - forecast) * 1000) / 1000;
    if (!byWarehouse.has(warehouse_id)) byWarehouse.set(warehouse_id, []);
    byWarehouse.get(warehouse_id).push({ product_id, quantity: qty });
  }
  for (const [warehouse_id, lines] of byWarehouse) {
    const op = await createOperation(client, 'receipt',
      { warehouse_id, lines, notes: 'Created by replenishment (reorder rules)' }, user);
    created.push(op);
  }
  return created;
}
