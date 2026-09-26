// Products, categories and reordering rules
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { ah, notFound, badRequest } from '../middleware/errors.js';
import { requireManager } from '../middleware/auth.js';
import { body, query as q } from '../middleware/validate.js';
import { id, optionalId, qty, text, optionalText, paging } from '../lib/schemas.js';
import { createOperation, validateOperation, replenish } from '../services/inventory.js';

const router = Router();

// ------------------------------------------------------------------ categories
router.get('/categories', ah(async (_req, res) => {
  const { rows } = await query(
    `SELECT c.*, COUNT(p.id)::int AS product_count FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.active
      GROUP BY c.id ORDER BY c.name`);
  res.json(rows);
}));
router.post('/categories', requireManager, body(z.object({ name: text(2, 60, 'Name') })), ah(async (req, res) => {
  const { rows } = await query('INSERT INTO categories (name) VALUES ($1) RETURNING *', [req.body.name]);
  res.status(201).json(rows[0]);
}));
router.put('/categories/:id', requireManager, body(z.object({ name: text(2, 60, 'Name') })), ah(async (req, res) => {
  const { rows } = await query('UPDATE categories SET name=$2 WHERE id=$1 RETURNING *', [id.parse(req.params.id), req.body.name]);
  if (!rows[0]) throw notFound('Category');
  res.json(rows[0]);
}));
router.delete('/categories/:id', requireManager, ah(async (req, res) => {
  const { rowCount } = await query('DELETE FROM categories WHERE id=$1', [id.parse(req.params.id)]);
  if (!rowCount) throw notFound('Category');
  res.status(204).end();
}));

// ------------------------------------------------------------------ products
const UOMS = ['Units', 'kg', 'g', 'L', 'mL', 'm', 'cm', 'Box', 'Pack', 'Pair', 'Dozen'];
const sku = z.string({ required_error: 'SKU is required' }).trim().toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, 'Use 2–40 letters, numbers or dashes');
const productSchema = z.object({
  name: text(2, 120, 'Name'),
  sku,
  category_id: optionalId.nullable(),
  uom: z.enum(UOMS, { errorMap: () => ({ message: 'Choose a unit of measure' }) }),
  unit_cost: qty.optional().default(0),
});
const createSchema = productSchema.extend({
  initial_stock: qty.optional(),
  initial_location_id: optionalId,
});

// Stock level shared by list + dashboard: sum of quants in internal locations
const ON_HAND_SQL = (whParam) => `
  COALESCE((SELECT SUM(sq.quantity) FROM stock_quants sq JOIN locations l ON l.id = sq.location_id
             WHERE sq.product_id = p.id AND l.type = 'internal' ${whParam ? `AND l.warehouse_id = ${whParam}` : ''}), 0)`;
const MIN_SQL = (whParam) => `
  (SELECT SUM(r.min_qty) FROM reorder_rules r WHERE r.product_id = p.id ${whParam ? `AND r.warehouse_id = ${whParam}` : ''})`;

router.get('/uoms', (_req, res) => res.json(UOMS));

router.get('/products', q(z.object({
  search: z.string().trim().max(80).optional(),
  category_id: optionalId,
  warehouse_id: optionalId,
  stock: z.enum(['all', 'in', 'low', 'out']).default('all'),
  include_archived: z.coerce.boolean().default(false),
  ...paging,
})), ah(async (req, res) => {
  const f = req.q;
  const params = [];
  const where = [];
  if (!f.include_archived) where.push('p.active');
  if (f.search) { params.push(`%${f.search}%`); where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`); }
  if (f.category_id) { params.push(f.category_id); where.push(`p.category_id = $${params.length}`); }
  let wh = null;
  if (f.warehouse_id) { params.push(f.warehouse_id); wh = `$${params.length}`; }

  const base = `
    SELECT p.*, c.name AS category_name, ${ON_HAND_SQL(wh)} AS on_hand, ${MIN_SQL(wh)} AS min_qty
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const stockFilter = {
    all: '',
    in: 'WHERE on_hand > 0',
    out: 'WHERE on_hand = 0',
    low: 'WHERE on_hand > 0 AND min_qty IS NOT NULL AND on_hand <= min_qty',
  }[f.stock];

  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await query(
    `SELECT *, COUNT(*) OVER()::int AS total_count FROM (${base}) t ${stockFilter}
      ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ items: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize });
}));

router.get('/products/:id', ah(async (req, res) => {
  const pid = id.parse(req.params.id);
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name, ${ON_HAND_SQL(null)} AS on_hand
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = $1`, [pid]);
  if (!rows[0]) throw notFound('Product');
  const [stock, rules, incoming] = await Promise.all([
    query(`SELECT l.id AS location_id, l.name AS location_name, w.id AS warehouse_id, w.name AS warehouse_name, w.code,
                  sq.quantity
             FROM stock_quants sq JOIN locations l ON l.id = sq.location_id JOIN warehouses w ON w.id = l.warehouse_id
            WHERE sq.product_id = $1 AND sq.quantity > 0 ORDER BY w.name, l.name`, [pid]),
    query(`SELECT r.*, w.name AS warehouse_name, w.code FROM reorder_rules r JOIN warehouses w ON w.id = r.warehouse_id
            WHERE r.product_id = $1 ORDER BY w.name`, [pid]),
    query(`SELECT o.type, COALESCE(SUM(ol.quantity),0) AS qty FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id
            WHERE ol.product_id = $1 AND o.status IN ('draft','waiting','ready') AND o.type IN ('receipt','delivery')
            GROUP BY o.type`, [pid]),
  ]);
  const pending = Object.fromEntries(incoming.rows.map((r) => [r.type, r.qty]));
  res.json({
    ...rows[0],
    stock: stock.rows,
    reorder_rules: rules.rows,
    incoming: pending.receipt ?? 0,
    outgoing: pending.delivery ?? 0,
    forecast: rows[0].on_hand + (pending.receipt ?? 0) - (pending.delivery ?? 0),
  });
}));

router.post('/products', requireManager, body(createSchema), ah(async (req, res) => {
  const d = req.body;
  if (d.initial_stock > 0 && !d.initial_location_id) {
    throw badRequest('Choose where the initial stock is', { initial_location_id: 'Choose a location' });
  }
  const product = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO products (name, sku, category_id, uom, unit_cost) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [d.name, d.sku, d.category_id ?? null, d.uom, d.unit_cost]);
    // Initial stock goes through the ledger like everything else: a validated adjustment.
    if (d.initial_stock > 0) {
      const op = await createOperation(client, 'adjustment', {
        source_location_id: d.initial_location_id,
        notes: `Initial stock for ${d.sku}`,
        lines: [{ product_id: rows[0].id, quantity: d.initial_stock }],
      }, req.user);
      await validateOperation(client, op.id, { ...req.user, role: 'manager' });
    }
    return rows[0];
  });
  res.status(201).json(product);
}));

router.put('/products/:id', requireManager, body(productSchema), ah(async (req, res) => {
  const d = req.body;
  const { rows } = await query(
    `UPDATE products SET name=$2, sku=$3, category_id=$4, uom=$5, unit_cost=$6, updated_at=now() WHERE id=$1 RETURNING *`,
    [id.parse(req.params.id), d.name, d.sku, d.category_id ?? null, d.uom, d.unit_cost]);
  if (!rows[0]) throw notFound('Product');
  res.json(rows[0]);
}));

// Products are archived, never deleted: the ledger must keep pointing at them
router.patch('/products/:id/archive', requireManager, body(z.object({ active: z.boolean() })), ah(async (req, res) => {
  const { rows } = await query('UPDATE products SET active=$2, updated_at=now() WHERE id=$1 RETURNING *',
    [id.parse(req.params.id), req.body.active]);
  if (!rows[0]) throw notFound('Product');
  res.json(rows[0]);
}));

// ------------------------------------------------------------------ reordering rules
const ruleSchema = z.object({ product_id: id, warehouse_id: id, min_qty: qty, max_qty: qty })
  .refine((r) => r.max_qty >= r.min_qty, { message: 'Max must be at least Min', path: ['max_qty'] });

router.get('/reorder-rules', q(z.object({ warehouse_id: optionalId })), ah(async (req, res) => {
  const params = [];
  let where = '';
  if (req.q.warehouse_id) { params.push(req.q.warehouse_id); where = 'WHERE r.warehouse_id = $1'; }
  const { rows } = await query(
    `SELECT r.*, p.name AS product_name, p.sku, p.uom, w.name AS warehouse_name, w.code,
            COALESCE((SELECT SUM(sq.quantity) FROM stock_quants sq JOIN locations l ON l.id = sq.location_id
                       WHERE sq.product_id = r.product_id AND l.warehouse_id = r.warehouse_id), 0) AS on_hand,
            COALESCE((SELECT SUM(ol.quantity) FROM operation_lines ol JOIN operations o ON o.id = ol.operation_id
                       WHERE ol.product_id = r.product_id AND o.warehouse_id = r.warehouse_id
                         AND o.type='receipt' AND o.status IN ('draft','waiting','ready')), 0) AS incoming
       FROM reorder_rules r JOIN products p ON p.id = r.product_id JOIN warehouses w ON w.id = r.warehouse_id
      ${where} ORDER BY p.name, w.name`, params);
  res.json(rows.map((r) => ({ ...r, needs_reorder: r.on_hand <= r.min_qty && r.on_hand + r.incoming < r.max_qty })));
}));
router.post('/reorder-rules', requireManager, body(ruleSchema), ah(async (req, res) => {
  const r = req.body;
  const { rows } = await query(
    'INSERT INTO reorder_rules (product_id, warehouse_id, min_qty, max_qty) VALUES ($1,$2,$3,$4) RETURNING *',
    [r.product_id, r.warehouse_id, r.min_qty, r.max_qty]);
  res.status(201).json(rows[0]);
}));
router.put('/reorder-rules/:id', requireManager, body(ruleSchema), ah(async (req, res) => {
  const r = req.body;
  const { rows } = await query(
    'UPDATE reorder_rules SET product_id=$2, warehouse_id=$3, min_qty=$4, max_qty=$5 WHERE id=$1 RETURNING *',
    [id.parse(req.params.id), r.product_id, r.warehouse_id, r.min_qty, r.max_qty]);
  if (!rows[0]) throw notFound('Reordering rule');
  res.json(rows[0]);
}));
router.delete('/reorder-rules/:id', requireManager, ah(async (req, res) => {
  const { rowCount } = await query('DELETE FROM reorder_rules WHERE id=$1', [id.parse(req.params.id)]);
  if (!rowCount) throw notFound('Reordering rule');
  res.status(204).end();
}));

// Turn low-stock alerts into draft receipts in one click
router.post('/replenish', body(z.object({
  items: z.array(z.object({ product_id: id, warehouse_id: id })).min(1, 'Pick at least one product'),
})), ah(async (req, res) => {
  const created = await withTransaction((client) => replenish(client, req.body.items, req.user));
  res.status(201).json({ created });
}));

export default router;
