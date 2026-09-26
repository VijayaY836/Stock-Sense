import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { ah, AppError, badRequest } from '../middleware/errors.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { body } from '../middleware/validate.js';
import { email, password, text } from '../lib/schemas.js';
import { sendOtp } from '../services/mailer.js';

const router = Router();
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at });

const signupSchema = z.object({
  name: text(2, 80, 'Name'),
  email,
  password,
  role: z.enum(['manager', 'staff'], { errorMap: () => ({ message: 'Choose a role' }) }),
});

router.post('/signup', body(signupSchema), ah(async (req, res) => {
  const { name, email, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *',
    [name, email, hash, role]);
  res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]), redirect_to: '/dashboard' });
}));

router.post('/login', body(z.object({ email, password: z.string().min(1, 'Password is required') })), ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [req.body.email]);
  const user = rows[0];
  // Same message whether the email or the password is wrong (no account enumeration)
  const ok = user && (await bcrypt.compare(req.body.password, user.password_hash));
  if (!ok) throw new AppError(401, 'Email or password is incorrect');
  res.json({ token: signToken(user), user: publicUser(user), redirect_to: '/dashboard' });
}));

// ---- OTP password reset:  forgot -> verify (get short-lived reset token) -> reset
const GENERIC = 'If an account exists for that email, a 6-digit code has been sent.';

router.post('/forgot-password', body(z.object({ email })), ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1', [req.body.email]);
  const user = rows[0];
  if (user) {
    const recent = await query(
      `SELECT 1 FROM password_resets WHERE user_id=$1 AND created_at > now() - make_interval(secs => $2)`,
      [user.id, config.otp.resendCooldownSeconds]);
    if (recent.rowCount) throw new AppError(429, `Please wait ${config.otp.resendCooldownSeconds} seconds before requesting another code`);
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    // Invalidate older codes, store only a hash of the new one
    await query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    await query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [user.id, await bcrypt.hash(otp, 10), config.otp.ttlMinutes]);
    await sendOtp(user.email, user.name, otp);
  }
  res.json({ message: GENERIC });
}));

router.post('/verify-otp', body(z.object({ email, otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') })), ah(async (req, res) => {
  const invalid = () => badRequest('That code is invalid or has expired', { otp: 'Invalid or expired code' });
  const { rows } = await query(
    `SELECT pr.* FROM password_resets pr JOIN users u ON u.id = pr.user_id
      WHERE lower(u.email) = $1 AND pr.used_at IS NULL ORDER BY pr.created_at DESC LIMIT 1`, [req.body.email]);
  const reset = rows[0];
  if (!reset || new Date(reset.expires_at) < new Date()) throw invalid();
  if (reset.attempts >= config.otp.maxAttempts) {
    throw badRequest('Too many attempts. Request a new code.', { otp: 'Too many attempts' });
  }
  const match = await bcrypt.compare(req.body.otp, reset.otp_hash);
  if (!match) {
    await query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [reset.id]);
    throw invalid();
  }
  await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]); // single use
  const resetToken = jwt.sign({ sub: reset.user_id, purpose: 'reset', rid: reset.id }, config.jwtSecret, { expiresIn: '10m' });
  res.json({ reset_token: resetToken });
}));

router.post('/reset-password', body(z.object({ reset_token: z.string().min(1), password })), ah(async (req, res) => {
  let payload;
  try {
    payload = jwt.verify(req.body.reset_token, config.jwtSecret);
    if (payload.purpose !== 'reset') throw new Error();
  } catch {
    throw badRequest('Your reset session expired. Start again.');
  }
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [payload.sub, await bcrypt.hash(req.body.password, 10)]);
  res.json({ message: 'Password updated. You can sign in now.' });
}));

// ---- profile
router.get('/me', requireAuth, ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0]) throw new AppError(401, 'Please sign in');
  res.json(publicUser(rows[0]));
}));

router.patch('/me', requireAuth, body(z.object({ name: text(2, 80, 'Name') })), ah(async (req, res) => {
  const { rows } = await query('UPDATE users SET name = $2 WHERE id = $1 RETURNING *', [req.user.id, req.body.name]);
  res.json({ user: publicUser(rows[0]), token: signToken(rows[0]) });
}));

router.post('/me/password', requireAuth,
  body(z.object({ current_password: z.string().min(1, 'Enter your current password'), new_password: password })),
  ah(async (req, res) => {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(req.body.current_password, rows[0].password_hash))) {
      throw badRequest('Current password is incorrect', { current_password: 'Incorrect password' });
    }
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(req.body.new_password, 10)]);
    res.json({ message: 'Password changed' });
  }));

export default router;
