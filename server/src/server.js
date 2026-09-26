import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`\n✖ Cannot reach PostgreSQL at DATABASE_URL.\n  ${err.message}\n  Is Postgres running, and does server/.env have the right password?\n`);
  process.exit(1);
}

createApp().listen(config.port, () => {
  console.log(`StockSense API running on http://localhost:${config.port}`);
});
