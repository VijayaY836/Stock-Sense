// Tests run against TEST_DATABASE_URL, which is wiped before each test file.
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { migrate } = await import('../db/migrate.js');
const { pool } = await import('../src/db.js');
const { default: request } = await import('supertest');
const { testOutbox } = await import('../src/services/mailer.js');

export { pool, testOutbox };
export const app = createApp();
export const api = () => request(app);

export const PASSWORD = 'Str0ng!Pass';

/** Fresh schema + a manager, a staff user, one warehouse with a Rack, and two products. */
export async function setup() {
  await migrate({ reset: true, silent: true });
  const signup = async (name, email, role) =>
    (await api().post('/api/auth/signup').send({ name, email, password: PASSWORD, role }).expect(201)).body.token;
  const managerToken = await signup('Mia Manager', 'mia@test.dev', 'manager');
  const staffToken = await signup('Sam Staff', 'sam@test.dev', 'staff');

  const m = asUser(managerToken);
  const wh = (await m.post('/api/warehouses').send({ name: 'Main', code: 'WH' }).expect(201)).body;
  const rack = (await m.post(`/api/warehouses/${wh.id}/locations`).send({ name: 'Production Rack' }).expect(201)).body;
  const locations = (await m.get('/api/locations').expect(200)).body;
  const stock = locations.find((l) => l.warehouse_id === wh.id && l.is_default);
  const steel = (await m.post('/api/products').send({ name: 'Steel', sku: 'STEEL', uom: 'kg' }).expect(201)).body;
  const chair = (await m.post('/api/products').send({ name: 'Chair', sku: 'CHAIR', uom: 'Units' }).expect(201)).body;
  return { m, s: asUser(staffToken), wh, rack, stock, steel, chair };
}

/** A supertest wrapper that sends the bearer token. */
export function asUser(token) {
  const withAuth = (method) => (url) => api()[method](url).set('Authorization', `Bearer ${token}`);
  return { get: withAuth('get'), post: withAuth('post'), put: withAuth('put'), patch: withAuth('patch'), del: withAuth('delete') };
}

export async function onHand(productId, locationId) {
  const { rows } = await pool.query('SELECT quantity FROM stock_quants WHERE product_id=$1 AND location_id=$2', [productId, locationId]);
  return rows[0]?.quantity ?? 0;
}

/** Create + validate an operation in one go. */
export async function doOp(user, type, data) {
  const op = (await user.post('/api/operations').send({ type, ...data }).expect(201)).body;
  return (await user.post(`/api/operations/${op.id}/validate`).expect(200)).body;
}
