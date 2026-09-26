import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { ah, notFound } from '../middleware/errors.js';
import { body, query as q } from '../middleware/validate.js';
import { id, optionalId, qty, optionalText, dateStr, paging } from '../lib/schemas.js';
import * as inv from '../services/inventory.js';

const router = Router();
const TYPES = ['receipt', 'delivery', 'internal', 'adjustment'];
const STATUSES = ['draft', 'waiting', 'ready', 'done', 'canceled'];

const lineSchema = z.object({ product_id: id, quantity: qty });
const opSchema = z.object({
  warehouse_id: optionalId,
  source_location_id: optionalId,
  dest_location_id: optionalId,
  partner: optionalText(120),
  scheduled_date: dateStr.optional().nullable(),
  notes: optionalText(1000),
  lines: z.array(lineSchema, { required_error: 'Add at least one product' }).min(1, 'Add at least one product').max(200),
});

const LIST_SQL = `
  SELECT o.*, w.name AS warehouse_name, w.code AS warehouse_code,
         sl.name AS source_name, sl.type AS source_type, sw.code AS source_wh,
         dl.name AS dest_name, dl.type AS dest_type, dw.code AS dest_wh,
         u.name AS created_by_name,
         (SELECT COUNT(*)::int FROM operation_lines WHERE operation_id = o.id) AS line_count,
         (SELECT COALESCE(SUM(quantity),0) FROM operation_lines WHERE operation_id = o.id) AS total_qty,
         (o.status NOT IN ('done','canceled') AND o.scheduled_date < CURRENT_DATE) AS is_late
    FROM operations o
    JOIN warehouses w ON w.id = o.warehouse_id
    JOIN locations sl ON sl.id = o.source_location_id LEFT JOIN warehouses sw ON sw.id = sl.warehouse_id
    JOIN locations dl ON dl.id = o.dest_location_id   LEFT JOIN warehouses dw ON dw.id = dl.warehouse_id
    LEFT JOIN users u ON u.id = o.created_by`;

router.get('/operations', q(z.object({
  type: z.enum(TYPES).optional(),
  status: z.union([z.enum([...STATUSES, 'open']), z.literal('')]).optional(),
  warehouse_id: optionalId,
  category_id: optionalId,
  search: z.string().trim().max(80).optional(),
  late: z.coerce.boolean().optional(),
  ...paging,
})), ah(async (req, res) => {
  const f = req.q;
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.type) add('o.type = ?', f.type);
  if (f.status === 'open') where.push(`o.status IN ('draft','waiting','ready')`);
  else if (f.status) add('o.status = ?', f.status);
  if (f.warehouse_id) add('o.warehouse_id = ?', f.warehouse_id);
  if (f.category_id) add(`EXISTS (SELECT 1 FROM operation_lines ol JOIN products p ON p.id = ol.product_id
                                  WHERE ol.operation_id = o.id AND p.category_id = ?)`, f.category_id);
  if (f.search) add(`(o.reference ILIKE ? OR o.partner ILIKE $${params.length + 1} OR EXISTS (
                        SELECT 1 FROM operation_lines ol JOIN products p ON p.id = ol.product_id
                         WHERE ol.operation_id = o.id AND (p.sku ILIKE $${params.length + 1} OR p.name ILIKE $${params.length + 1})))`,
                    `%${f.search}%`);
  if (f.late) where.push(`o.status NOT IN ('done','canceled') AND o.scheduled_date < CURRENT_DATE`);
  params.push(f.pageSize, (f.page - 1) * f.pageSize);
  const { rows } = await query(
    `SELECT t.*, COUNT(*) OVER()::int AS total_count FROM (${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) t
      ORDER BY (t.status IN ('done','canceled')), t.scheduled_date ASC, t.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ items: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, page: f.page, pageSize: f.pageSize });
}));

async function fullOperation(opId) {
  const { rows } = await query(`${LIST_SQL} WHERE o.id = $1`, [opId]);
  if (!rows[0]) throw notFound('Operation');
  const op = rows[0];
  const [lines, moves, extra] = await Promise.all([
    query(`SELECT l.*, p.name AS product_name, p.sku, p.uom,
                  COALESCE((SELECT quantity FROM stock_quants WHERE product_id = l.product_id AND location_id = $2), 0) AS available
             FROM operation_lines l JOIN products p ON p.id = l.product_id WHERE l.operation_id = $1 ORDER BY p.name`,
          [opId, op.source_location_id]),
    query(`SELECT m.*, p.sku, p.name AS product_name FROM stock_moves m JOIN products p ON p.id = m.product_id
            WHERE m.operation_id = $1 ORDER BY m.id`, [opId]),
    query(`SELECT v.name AS validated_by_name, r.reference AS return_of_reference,
                  (SELECT json_agg(json_build_object('id', x.id, 'reference', x.reference, 'status', x.status))
                     FROM operations x WHERE x.return_of_id = o.id) AS returns
             FROM operations o LEFT JOIN users v ON v.id = o.validated_by LEFT JOIN operations r ON r.id = o.return_of_id
            WHERE o.id = $1`, [opId]),
  ]);
  return { ...op, ...extra.rows[0], lines: lines.rows, moves: moves.rows };
}

router.get('/operations/:id', ah(async (req, res) => res.json(await fullOperation(id.parse(req.params.id)))));

router.post('/operations', body(opSchema.extend({ type: z.enum(TYPES, { errorMap: () => ({ message: 'Choose a type' }) }) })),
  ah(async (req, res) => {
    const op = await withTransaction((c) => inv.createOperation(c, req.body.type, req.body, req.user));
    res.status(201).json(await fullOperation(op.id));
  }));

router.put('/operations/:id', body(opSchema), ah(async (req, res) => {
  const opId = id.parse(req.params.id);
  await withTransaction((c) => inv.updateOperation(c, opId, req.body));
  res.json(await fullOperation(opId));
}));

// Actions. Each is one transaction; the response is the fresh operation.
const action = (fn) => ah(async (req, res) => {
  const opId = id.parse(req.params.id);
  const result = await withTransaction((c) => fn(c, opId, req.user));
  res.json({ ...(await fullOperation(result?.id ?? opId)), shortages: result?.shortages });
});
router.post('/operations/:id/confirm', action((c, opId) => inv.confirmOperation(c, opId)));
router.post('/operations/:id/check', action((c, opId) => inv.confirmOperation(c, opId)));
router.post('/operations/:id/validate', action((c, opId, user) => inv.validateOperation(c, opId, user)));
router.post('/operations/:id/cancel', action((c, opId) => inv.cancelOperation(c, opId)));
router.post('/operations/:id/return', ah(async (req, res) => {
  const op = await withTransaction((c) => inv.createReturn(c, id.parse(req.params.id), req.user));
  res.status(201).json(await fullOperation(op.id));
}));
router.delete('/operations/:id', ah(async (req, res) => {
  await withTransaction((c) => inv.deleteOperation(c, id.parse(req.params.id)));
  res.status(204).end();
}));

export default router;
