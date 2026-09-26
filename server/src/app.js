import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import warehouseRoutes from './routes/warehouses.js';
import operationRoutes from './routes/operations.js';
import reportRoutes from './routes/reports.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '200kb' }));
  if (!config.isTest) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  // Everything below needs a signed-in user
  app.use('/api', requireAuth, catalogRoutes, warehouseRoutes, operationRoutes, reportRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(errorHandler);
  return app;
}
