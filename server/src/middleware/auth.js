import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError, forbidden } from './errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

/** Requires a valid Bearer token; sets req.user = { id, role, name } */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'Please sign in'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.purpose) throw new Error('wrong token type'); // reset tokens can't be used as sessions
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
    next();
  } catch {
    next(new AppError(401, 'Your session has expired. Please sign in again'));
  }
}

/** Only Inventory Managers */
export function requireManager(req, _res, next) {
  if (req.user?.role !== 'manager') return next(forbidden('Only Inventory Managers can do this'));
  next();
}
