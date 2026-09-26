// Move history (the stock ledger) and the dashboard
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { ah } from '../middleware/errors.js';
import { query as q } from '../middleware/validate.js';
import { optionalId, dateStr, paging } from '../lib/schemas.js';

const router = Router();

router.get('/moves', q(z.object({
  product_id: optionalId,
  warehouse_id: optionalId,
  location_id: optionalId,
  type: z.enum(['receipt', 'delivery', 'internal', 'adjustment']).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  search: z.string().trim().max(80).optional(),
  ...paging,
})), ah(async (req, res) => {
  const f = req.q;
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (f.product_id) add('b.product_id = ?', f.product_id);
  if (f.location_id) add('(b.from_location_id = ? OR b.to_location_id = ?)', f.location_id);
  let whRef = null;
  if (f.warehouse_id) { add('(fl.warehouse_id = ? OR tl.warehouse_id = ?)', f.warehouse_id); whRef = `$${params.length}`; }
  if (f.type) add('o.type = ?', f.type);
  if (f.from) add('b.created_at >= ?::date', f.from);
  if (f.to) add(`b.created_at < (?::date + 1)`, f.to);
  if (f.search) add('(o.reference ILIKE ? OR p.sku ILIKE ? OR p.name ILIKE ?)', `%${f.search}%`);

  // "Internal" for the running balance = internal locations (of the chosen warehouse, if filtered)
  const inScope = (alias) => `(${alias}.type = 'internal'${whRef ? ` AND ${alias}.warehouse_id = ${whRef}` : ''})`;

  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await query(`
    WITH ledger AS (
      SELECT m.*, o.reference, o.type AS operation_type, o.partner,
             p.sku, p.name AS product_name, p.uom,
             CASE WHEN fw.code IS NULL THEN fl.name ELSE fw.code || '/' || fl.name END AS from_name,
             CASE WHEN tw.code IS NULL THEN tl.name ELSE tw.code || '/' || tl.name END AS to_name,
             u.name AS user_name,
             (CASE WHEN ${inScope('tl')} THEN m.quantity ELSE 0 END)
               - (CASE WHEN ${inScope('fl')} THEN m.quantity ELSE 0 END) AS delta
        FROM stock_moves m
        JOIN operations o ON o.id = m.operation_id
        JOIN products p   ON p.id = m.product_id
        JOIN locations fl ON fl.id = m.from_location_id LEFT JOIN warehouses fw ON fw.id = fl.warehouse_id
        JOIN locations tl ON tl.id = m.to_location_id   LEFT JOIN warehouses tw ON tw.id = tl.warehouse_id
        LEFT JOIN users u ON u.id = m.created_by
    ),
    balanced AS (
      -- running on-hand balance per product, computed over the FULL history before filtering by date/search
      SELECT l.*, SUM(delta) OVER (PARTITION BY product_id ORDER BY created_at, id) AS balance FROM ledger l
    )
    SELECT b.*, COUNT(*) OVER()::int AS total_count
      FROM balanced b
      JOIN operations o ON o.id = b.operation_id JOIN products p ON p.id = b.product_id
      JOIN locations fl ON fl.id = b.from_location_id JOIN locations tl ON tl.id = b.to_location_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ items: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize });
}));

// On-hand quantities at one location: { [product_id]: qty } (used by operation forms)
router.get('/stock', q(z.object({ location_id: optionalId })), ah(async (req, res) => {
  if (!req.q.location_id) return res.json({});
  const { rows } = await query('SELECT product_id, quantity FROM stock_quants WHERE location_id = $1', [req.q.location_id]);
  res.json(Object.fromEntries(rows.map((r) => [r.product_id, r.quantity])));
}));

router.get('/dashboard', q(z.object({ warehouse_id: optionalId, category_id: optionalId })), ah(async (req, res) => {
  const { warehouse_id: wh, category_id: cat } = req.q;
  const params = [wh ?? null, cat ?? null];
  const productFilter = `p.active AND ($2::int IS NULL OR p.category_id = $2)`;
  const onHand = `COALESCE((SELECT SUM(sq.quantity) FROM stock_quants sq JOIN locations l ON l.id = sq.location_id
                             WHERE sq.product_id = p.id AND l.type='internal' AND ($1::int IS NULL OR l.warehouse_id = $1)), 0)`;
  const minQty = `(SELECT SUM(r.min_qty) FROM reorder_rules r WHERE r.product_id = p.id AND ($1::int IS NULL OR r.warehouse_id = $1))`;
  const opFilter = `($1::int IS NULL OR o.warehouse_id = $1) AND ($2::int IS NULL OR EXISTS (
                      SELECT 1 FROM operation_lines ol JOIN products p ON p.id = ol.product_id
                       WHERE ol.operation_id = o.id AND p.category_id = $2))`;

  const [stock, ops, lowList, flow, recent] = await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE on_hand > 0)::int AS in_stock,
                  COUNT(*) FILTER (WHERE on_hand = 0)::int AS out_of_stock,
                  COUNT(*) FILTER (WHERE on_hand > 0 AND min_qty IS NOT NULL AND on_hand <= min_qty)::int AS low_stock,
                  COUNT(*)::int AS total_products,
                  COALESCE(SUM(on_hand * unit_cost), 0) AS stock_value
             FROM (SELECT p.unit_cost, ${onHand} AS on_hand, ${minQty} AS min_qty FROM products p WHERE ${productFilter}) t`, params),
    query(`SELECT o.type, o.status, COUNT(*)::int AS n,
                  COUNT(*) FILTER (WHERE o.scheduled_date < CURRENT_DATE)::int AS late
             FROM operations o WHERE o.status IN ('draft','waiting','ready') AND ${opFilter}
            GROUP BY o.type, o.status`, params),
    query(`SELECT * FROM (
             SELECT p.id, p.name, p.sku, p.uom, ${onHand} AS on_hand, ${minQty} AS min_qty,
                    (SELECT json_agg(r.warehouse_id) FROM reorder_rules r WHERE r.product_id = p.id
                       AND ($1::int IS NULL OR r.warehouse_id = $1)) AS rule_warehouses
               FROM products p WHERE ${productFilter}) t
            WHERE on_hand = 0 OR (min_qty IS NOT NULL AND on_hand <= min_qty)
            ORDER BY (on_hand = 0) DESC, (on_hand / NULLIF(min_qty, 0)) ASC NULLS LAST, name LIMIT 8`, params),
    query(`SELECT o.type, COALESCE(SUM(m.quantity), 0) AS qty, COUNT(DISTINCT o.id)::int AS n
             FROM stock_moves m JOIN operations o ON o.id = m.operation_id JOIN products p ON p.id = m.product_id
            WHERE m.created_at > now() - interval '7 days' AND ($1::int IS NULL OR o.warehouse_id = $1)
              AND ($2::int IS NULL OR p.category_id = $2)
            GROUP BY o.type`, params),
    query(`SELECT m.id, m.quantity, m.created_at, o.reference, o.type, p.sku, p.name AS product_name, p.uom
             FROM stock_moves m JOIN operations o ON o.id = m.operation_id JOIN products p ON p.id = m.product_id
            WHERE ($1::int IS NULL OR o.warehouse_id = $1) AND ($2::int IS NULL OR p.category_id = $2)
            ORDER BY m.id DESC LIMIT 6`, params),
  ]);

  const pending = { receipt: {}, delivery: {}, internal: {}, adjustment: {} };
  for (const r of ops.rows) {
    const t = pending[r.type];
    t[r.status] = r.n;
    t.total = (t.total ?? 0) + r.n;
    t.late = (t.late ?? 0) + r.late;
  }
  res.json({
    kpis: {
      ...stock.rows[0],
      pending_receipts: pending.receipt.total ?? 0,
      pending_deliveries: pending.delivery.total ?? 0,
      scheduled_transfers: pending.internal.total ?? 0,
      pending_adjustments: pending.adjustment.total ?? 0,
    },
    pending,
    low_stock: lowList.rows,
    last7days: Object.fromEntries(flow.rows.map((r) => [r.type, { qty: r.qty, operations: r.n }])),
    recent_moves: recent.rows,
  });
}));

export default router;
