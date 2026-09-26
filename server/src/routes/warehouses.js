import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { ah, notFound, conflict } from '../middleware/errors.js';
import { requireManager } from '../middleware/auth.js';
import { body } from '../middleware/validate.js';
import { id, text, optionalText } from '../lib/schemas.js';

const router = Router();
const code = z.string({ required_error: 'Code is required' }).trim().toUpperCase()
  .regex(/^[A-Z0-9]{2,8}$/, 'Use 2–8 letters or numbers, e.g. WH or BLR1');
const whSchema = z.object({ name: text(2, 80, 'Name'), code, address: optionalText(300) });

router.get('/warehouses', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT w.*,
            COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name, 'is_default', l.is_default, 'active', l.active,
                     'on_hand', COALESCE((SELECT SUM(quantity) FROM stock_quants WHERE location_id = l.id), 0))
                     ORDER BY l.is_default DESC, l.name) FILTER (WHERE l.id IS NOT NULL), '[]') AS locations
       FROM warehouses w LEFT JOIN locations l ON l.warehouse_id = w.id
      GROUP BY w.id ORDER BY w.name`);
  res.json(rows);
}));

router.post('/warehouses', requireManager, body(whSchema), ah(async (req, res) => {
  const wh = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO warehouses (name, code, address) VALUES ($1,$2,$3) RETURNING *',
      [req.body.name, req.body.code, req.body.address ?? null]);
    // every warehouse gets a default "Stock" location
    await client.query(
      `INSERT INTO locations (name, type, warehouse_id, is_default) VALUES ('Stock', 'internal', $1, true)`, [rows[0].id]);
    return rows[0];
  });
  res.status(201).json(wh);
}));

router.put('/warehouses/:id', requireManager, body(whSchema), ah(async (req, res) => {
  const wid = id.parse(req.params.id);
  const used = await query('SELECT 1 FROM operations WHERE warehouse_id = $1 LIMIT 1', [wid]);
  const current = await query('SELECT code FROM warehouses WHERE id = $1', [wid]);
  if (!current.rows[0]) throw notFound('Warehouse');
  if (used.rowCount && current.rows[0].code !== req.body.code) {
    throw conflict('The code is used in existing references and can no longer change', { code: 'Locked: already used in references' });
  }
  const { rows } = await query('UPDATE warehouses SET name=$2, code=$3, address=$4 WHERE id=$1 RETURNING *',
    [wid, req.body.name, req.body.code, req.body.address ?? null]);
  res.json(rows[0]);
}));

// ---- locations
router.get('/locations', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT l.*, w.code AS warehouse_code, w.name AS warehouse_name,
            CASE WHEN w.code IS NULL THEN l.name ELSE w.code || '/' || l.name END AS full_name
       FROM locations l LEFT JOIN warehouses w ON w.id = l.warehouse_id
      WHERE l.active ORDER BY l.type, w.name NULLS FIRST, l.is_default DESC, l.name`);
  res.json(rows);
}));

router.post('/warehouses/:id/locations', requireManager, body(z.object({ name: text(1, 80, 'Name') })), ah(async (req, res) => {
  const wid = id.parse(req.params.id);
  const { rows } = await query(
    `INSERT INTO locations (name, type, warehouse_id) VALUES ($1, 'internal', $2) RETURNING *`, [req.body.name, wid]);
  res.status(201).json(rows[0]);
}));

router.put('/locations/:id', requireManager,
  body(z.object({ name: text(1, 80, 'Name'), active: z.boolean().optional() })), ah(async (req, res) => {
    const lid = id.parse(req.params.id);
    const { rows: [loc] } = await query('SELECT * FROM locations WHERE id=$1', [lid]);
    if (!loc || loc.type !== 'internal') throw notFound('Location');
    if (req.body.active === false) {
      if (loc.is_default) throw conflict('The default stock location cannot be archived');
      const stock = await query('SELECT 1 FROM stock_quants WHERE location_id=$1 AND quantity > 0', [lid]);
      if (stock.rowCount) throw conflict('Move the stock out of this location before archiving it');
    }
    const { rows } = await query('UPDATE locations SET name=$2, active=COALESCE($3, active) WHERE id=$1 RETURNING *',
      [lid, req.body.name, req.body.active ?? null]);
    res.json(rows[0]);
  }));

export default router;
