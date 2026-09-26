import { ZodError } from 'zod';

/** An expected, user-facing error. `fields` maps form field -> message. */
export class AppError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const badRequest = (msg, fields) => new AppError(400, msg, fields);
export const notFound = (what = 'Record') => new AppError(404, `${what} not found`);
export const conflict = (msg, fields) => new AppError(409, msg, fields);
export const forbidden = (msg = 'You do not have permission to do this') => new AppError(403, msg);

// Wrap async route handlers so thrown errors reach the error middleware
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Map unique-index names to the form field that caused them
const UNIQUE_FIELDS = {
  users_email_uq: ['email', 'An account with this email already exists'],
  products_sku_uq: ['sku', 'Another product already uses this SKU'],
  categories_name_uq: ['name', 'This category already exists'],
  warehouses_code_key: ['code', 'Another warehouse already uses this code'],
  locations_name_per_wh_uq: ['name', 'A location with this name already exists here'],
  reorder_one_per_product_wh: ['warehouse_id', 'This product already has a rule for that warehouse'],
  line_one_product_per_op: ['lines', 'Each product can appear only once per operation'],
};

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const fields = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return res.status(400).json({ error: 'Please fix the highlighted fields', fields });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, fields: err.fields });
  }
  // PostgreSQL constraint errors -> readable messages
  if (err.code === '23505') {
    const [field, msg] = UNIQUE_FIELDS[err.constraint] || ['_', 'This record already exists'];
    return res.status(409).json({ error: msg, fields: { [field]: msg } });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'This record is in use by other records and cannot be changed that way' });
  }
  if (err.code === '23514') {
    if (err.constraint === 'stock_quants_quantity_check') {
      return res.status(409).json({ error: 'Not enough stock for this operation' });
    }
    return res.status(400).json({ error: `Invalid value (${err.constraint})` });
  }
  if (err.code === 'P0001') return res.status(409).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });

  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
