// Demo data, created THROUGH the stock engine so the ledger and quants are consistent.
// Usage: npm run db:seed   (or npm run db:reset to wipe + migrate + seed)
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, withTransaction } from '../src/db.js';
import * as inv from '../src/services/inventory.js';

const DEMO_PASSWORD = 'Demo@1234';

export async function seed() {
  const { rowCount } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (rowCount) {
    console.log('Database already has data. Use `npm run db:reset` to start fresh.');
    return;
  }

  await withTransaction(async (c) => {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const { rows: [manager] } = await c.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Priya Manager', 'manager@stocksense.dev', $1, 'manager') RETURNING *`, [hash]);
    const { rows: [staff] } = await c.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ('Ravi Staff', 'staff@stocksense.dev', $1, 'staff') RETURNING *`, [hash]);

    // Warehouses + locations
    const wh = {};
    for (const [code, name, address] of [
      ['WH', 'Main Warehouse', 'Plot 12, Industrial Area Phase 2'],
      ['NDP', 'North Depot', 'Unit 4, Logistics Park'],
    ]) {
      const { rows: [w] } = await c.query('INSERT INTO warehouses (name, code, address) VALUES ($1,$2,$3) RETURNING *', [name, code, address]);
      wh[code] = { ...w, loc: {} };
    }
    const addLoc = async (code, name, isDefault = false) => {
      const { rows: [l] } = await c.query(
        `INSERT INTO locations (name, type, warehouse_id, is_default) VALUES ($1,'internal',$2,$3) RETURNING id`,
        [name, wh[code].id, isDefault]);
      wh[code].loc[name] = l.id;
    };
    for (const n of ['Stock', 'Rack A', 'Rack B', 'Production Floor']) await addLoc('WH', n, n === 'Stock');
    for (const n of ['Stock', 'Cold Room']) await addLoc('NDP', n, n === 'Stock');

    // Categories + products
    const cat = {};
    for (const n of ['Raw Materials', 'Furniture', 'Hardware', 'Packaging']) {
      const { rows: [r] } = await c.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [n]);
      cat[n] = r.id;
    }
    const products = [
      ['Steel Rods 12mm', 'RM-STL-ROD12', 'Raw Materials', 'kg', 78],
      ['Steel Sheet 2mm', 'RM-STL-SHT2', 'Raw Materials', 'kg', 92],
      ['Aluminium Tube 25mm', 'RM-ALU-TUB25', 'Raw Materials', 'm', 140],
      ['Birch Plywood 18mm', 'RM-PLY-18', 'Raw Materials', 'Units', 2350],
      ['Office Chair Ergo', 'FN-CHR-ERGO', 'Furniture', 'Units', 6400],
      ['Standing Desk Frame', 'FN-DSK-FRM', 'Furniture', 'Units', 11200],
      ['Bookshelf 5-Tier', 'FN-SHF-5T', 'Furniture', 'Units', 4800],
      ['Workshop Stool', 'FN-STL-WS', 'Furniture', 'Units', 1850],
      ['Hex Bolts M8 (100)', 'HW-BLT-M8', 'Hardware', 'Box', 420],
      ['Wood Screws 40mm (200)', 'HW-SCR-40', 'Hardware', 'Pack', 260],
      ['Soft-close Hinges', 'HW-HNG-SC', 'Hardware', 'Pair', 180],
      ['Castor Wheels 50mm', 'HW-CST-50', 'Hardware', 'Units', 95],
      ['Corrugated Box Large', 'PK-BOX-L', 'Packaging', 'Units', 38],
      ['Bubble Wrap Roll', 'PK-BWR-50', 'Packaging', 'm', 12],
      ['Wooden Pallet', 'PK-PLT-STD', 'Packaging', 'Units', 650],
      ['Welded Steel Frame', 'FN-FRM-WLD', 'Furniture', 'Units', 3200], // never received: out of stock
    ];
    const p = {};
    for (const [name, sku, category, uom, cost] of products) {
      const { rows: [r] } = await c.query(
        'INSERT INTO products (name, sku, category_id, uom, unit_cost) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [name, sku, cat[category], uom, cost]);
      p[sku] = r.id;
    }

    // Reordering rules (min, max) in the main warehouse
    const rules = {
      'RM-STL-ROD12': [150, 500], 'RM-STL-SHT2': [100, 400], 'RM-PLY-18': [20, 80], 'FN-CHR-ERGO': [15, 60],
      'FN-DSK-FRM': [8, 30], 'HW-BLT-M8': [25, 100], 'HW-CST-50': [80, 300], 'PK-BOX-L': [100, 400], 'FN-SHF-5T': [5, 20], 'FN-FRM-WLD': [10, 40],
    };
    for (const [sku, [min, max]] of Object.entries(rules)) {
      await c.query('INSERT INTO reorder_rules (product_id, warehouse_id, min_qty, max_qty) VALUES ($1,$2,$3,$4)',
        [p[sku], wh.WH.id, min, max]);
    }
    await c.query('INSERT INTO reorder_rules (product_id, warehouse_id, min_qty, max_qty) VALUES ($1,$2,10,40)', [p['FN-CHR-ERGO'], wh.NDP.id]);

    // ---- history, run through the engine, then back-dated
    const done = [];
    const run = async (type, data, { validate = true, confirm = false, by = manager, daysAgo = 0 } = {}) => {
      const op = await inv.createOperation(c, type, data, by);
      if (validate) await inv.validateOperation(c, op.id, type === 'adjustment' ? manager : by); // only managers apply counts
      else if (confirm) await inv.confirmOperation(c, op.id);
      if (validate) done.push([op.id, daysAgo]);
      return op;
    };
    const L = (sku, quantity) => ({ product_id: p[sku], quantity });

    await run('receipt', { warehouse_id: wh.WH.id, partner: 'Tata Steel Distributors', lines: [L('RM-STL-ROD12', 400), L('RM-STL-SHT2', 250)] }, { daysAgo: 13 });
    await run('receipt', { warehouse_id: wh.WH.id, partner: 'Greenply Traders', lines: [L('RM-PLY-18', 60), L('HW-SCR-40', 80), L('HW-HNG-SC', 150)] }, { daysAgo: 12 });
    await run('receipt', { warehouse_id: wh.WH.id, partner: 'Ergotek Seating', lines: [L('FN-CHR-ERGO', 45), L('FN-STL-WS', 30), L('HW-CST-50', 220)] }, { daysAgo: 11 });
    await run('receipt', { warehouse_id: wh.WH.id, partner: 'PackRight Supplies', lines: [L('PK-BOX-L', 350), L('PK-BWR-50', 500), L('PK-PLT-STD', 40), L('HW-BLT-M8', 60)] }, { daysAgo: 10 });
    await run('receipt', { warehouse_id: wh.WH.id, partner: 'Deskworks India', lines: [L('FN-DSK-FRM', 24), L('FN-SHF-5T', 12), L('RM-ALU-TUB25', 300)] }, { daysAgo: 9, by: staff });
    await run('internal', { source_location_id: wh.WH.loc.Stock, dest_location_id: wh.WH.loc['Production Floor'], lines: [L('RM-STL-ROD12', 180), L('RM-STL-SHT2', 90)], notes: 'Frame production batch 14' }, { daysAgo: 8, by: staff });
    await run('internal', { source_location_id: wh.WH.loc.Stock, dest_location_id: wh.WH.loc['Rack A'], lines: [L('HW-BLT-M8', 20), L('HW-SCR-40', 30)] }, { daysAgo: 8, by: staff });
    await run('delivery', { warehouse_id: wh.WH.id, partner: 'Brightspace Coworking', lines: [L('FN-CHR-ERGO', 24), L('FN-DSK-FRM', 12)] }, { daysAgo: 7 });
    await run('internal', { source_location_id: wh.WH.loc.Stock, dest_location_id: wh.NDP.loc.Stock, lines: [L('FN-CHR-ERGO', 12), L('PK-BOX-L', 80)], notes: 'Stock North Depot' }, { daysAgo: 6, by: staff });
    await run('delivery', { warehouse_id: wh.WH.id, partner: 'Nexa Interiors', lines: [L('FN-SHF-5T', 8), L('HW-HNG-SC', 40), L('PK-BOX-L', 120)] }, { daysAgo: 5 });
    await run('delivery', { warehouse_id: wh.NDP.id, partner: 'Studio Loom', lines: [L('FN-CHR-ERGO', 5)] }, { daysAgo: 4, by: staff });
    await run('adjustment', { source_location_id: wh.WH.loc['Production Floor'], notes: 'Damaged in handling', lines: [L('RM-STL-ROD12', 175)] }, { daysAgo: 3 });
    await run('delivery', { warehouse_id: wh.WH.id, partner: 'Brightspace Coworking', lines: [L('RM-STL-ROD12', 150), L('HW-CST-50', 150)] }, { daysAgo: 2 });
    await run('delivery', { warehouse_id: wh.WH.id, partner: 'Urban Nest Homes', lines: [L('FN-DSK-FRM', 7)] }, { daysAgo: 1 });

    // back-date history for a realistic ledger (seed only - the app itself never edits moves)
    await c.query('ALTER TABLE stock_moves DISABLE TRIGGER stock_moves_immutable');
    for (const [opId, daysAgo] of done) {
      const ts = `now() - interval '${daysAgo} days' + interval '${9 + (opId % 8)} hours' - interval '1 day'`;
      await c.query(`UPDATE stock_moves SET created_at = ${ts} WHERE operation_id = $1`, [opId]);
      await c.query(`UPDATE operations SET created_at = ${ts}, validated_at = ${ts}, updated_at = ${ts},
                     scheduled_date = (${ts})::date WHERE id = $1`, [opId]);
    }
    await c.query('ALTER TABLE stock_moves ENABLE TRIGGER stock_moves_immutable');

    // ---- open work, so the dashboard has something to act on
    const future = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
    await run('receipt', { warehouse_id: wh.WH.id, partner: 'Tata Steel Distributors', scheduled_date: future(2), lines: [L('RM-STL-ROD12', 300)] }, { validate: false });
    await run('receipt', { warehouse_id: wh.WH.id, partner: 'Ergotek Seating', scheduled_date: future(-1), lines: [L('FN-CHR-ERGO', 30), L('HW-CST-50', 100)] }, { validate: false, confirm: true });
    await run('delivery', { warehouse_id: wh.WH.id, partner: 'Nexa Interiors', scheduled_date: future(1), lines: [L('FN-STL-WS', 10), L('PK-BWR-50', 60)] }, { validate: false, confirm: true });
    await run('delivery', { warehouse_id: wh.WH.id, partner: 'Urban Nest Homes', scheduled_date: future(3), lines: [L('FN-DSK-FRM', 10)] }, { validate: false, confirm: true });
    await run('internal', { source_location_id: wh.WH.loc.Stock, dest_location_id: wh.WH.loc['Rack B'], scheduled_date: future(1), lines: [L('HW-HNG-SC', 50)] }, { validate: false, confirm: true, by: staff });
    await run('adjustment', { source_location_id: wh.WH.loc['Rack A'], notes: 'Weekly cycle count', lines: [L('HW-BLT-M8', 18)] }, { validate: false, by: staff });
  });

  console.log('✔ Demo data created');
  console.log(`  Manager: manager@stocksense.dev / ${DEMO_PASSWORD}`);
  console.log(`  Staff:   staff@stocksense.dev   / ${DEMO_PASSWORD}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });
}
