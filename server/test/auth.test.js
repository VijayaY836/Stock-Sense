import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, setup, pool, testOutbox, PASSWORD } from './helpers.js';

before(setup);
after(() => pool.end());

test('signup rejects weak passwords with field-level messages', async () => {
  const res = await api().post('/api/auth/signup').send({ name: 'A', email: 'bad', password: 'abc', role: 'boss' }).expect(400);
  assert.ok(res.body.fields.name);
  assert.ok(res.body.fields.email);
  assert.ok(res.body.fields.password);
  assert.ok(res.body.fields.role);
});

test('duplicate email (any case) is rejected', async () => {
  const res = await api().post('/api/auth/signup')
    .send({ name: 'Mia Two', email: 'MIA@test.dev', password: PASSWORD, role: 'staff' }).expect(409);
  assert.equal(res.body.fields.email, 'An account with this email already exists');
});

test('login returns a token and redirects to the dashboard; wrong password is a generic 401', async () => {
  const ok = await api().post('/api/auth/login').send({ email: 'mia@test.dev', password: PASSWORD }).expect(200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.redirect_to, '/dashboard');
  const bad = await api().post('/api/auth/login').send({ email: 'mia@test.dev', password: 'nope' }).expect(401);
  assert.equal(bad.body.error, 'Email or password is incorrect');
  await api().get('/api/products').expect(401);
});

test('OTP reset: hashed, single use, attempt-limited', async () => {
  // Unknown emails get the same answer (no account enumeration)
  const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost@test.dev' }).expect(200);
  await api().post('/api/auth/forgot-password').send({ email: 'sam@test.dev' }).expect(200);
  const known = await api().post('/api/auth/forgot-password').send({ email: 'sam@test.dev' }).expect(429); // cooldown
  assert.ok(known.body.error);
  assert.ok(unknown.body.message);

  const { otp } = testOutbox.at(-1);
  const stored = await pool.query('SELECT otp_hash FROM password_resets ORDER BY id DESC LIMIT 1');
  assert.notEqual(stored.rows[0].otp_hash, otp, 'OTP must be stored hashed');

  const wrong = otp === '000000' ? '111111' : '000000';
  await api().post('/api/auth/verify-otp').send({ email: 'sam@test.dev', otp: wrong }).expect(400);
  const ok = await api().post('/api/auth/verify-otp').send({ email: 'sam@test.dev', otp }).expect(200);
  await api().post('/api/auth/verify-otp').send({ email: 'sam@test.dev', otp }).expect(400); // replay blocked

  // reset token cannot be used as a session
  await api().get('/api/products').set('Authorization', `Bearer ${ok.body.reset_token}`).expect(401);

  await api().post('/api/auth/reset-password').send({ reset_token: ok.body.reset_token, password: 'N3w!Password' }).expect(200);
  await api().post('/api/auth/login').send({ email: 'sam@test.dev', password: 'N3w!Password' }).expect(200);
});

test('OTP locks after 5 wrong attempts', async () => {
  await pool.query(`UPDATE password_resets SET created_at = now() - interval '1 hour'`); // skip cooldown
  await api().post('/api/auth/forgot-password').send({ email: 'mia@test.dev' }).expect(200);
  const { otp } = testOutbox.at(-1);
  const wrong = otp === '999999' ? '888888' : '999999';
  for (let i = 0; i < 5; i++) await api().post('/api/auth/verify-otp').send({ email: 'mia@test.dev', otp: wrong }).expect(400);
  const res = await api().post('/api/auth/verify-otp').send({ email: 'mia@test.dev', otp }).expect(400);
  assert.match(res.body.error, /Too many attempts/);
});
