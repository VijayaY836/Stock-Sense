// Minimal migration runner: applies db/migrations/*.sql in order, once each.
// Usage: npm run db:migrate            (apply pending)
//        node db/migrate.js --reset    (drop everything, then apply all)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool } from '../src/db.js';
import { config } from '../src/config.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Creates the database named in the URL if it doesn't exist yet (saves a manual step on fresh installs). */
async function ensureDatabase(log) {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code !== '3D000') throw err; // 3D000 = database does not exist
    const url = new URL(config.databaseUrl);
    const name = decodeURIComponent(url.pathname.slice(1));
    url.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name.replaceAll('"', '')}"`);
    await admin.end();
    log(`• created database ${name}`);
  }
}

export async function migrate({ reset = false, silent = false } = {}) {
  const log = silent ? () => {} : console.log;
  await ensureDatabase(log);
  if (reset) {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    log('• schema reset');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`✔ applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
  log('Database is up to date.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch((err) => {
      console.error(`✖ ${err.message}`);
      if (err.code === '28P01') console.error('  Wrong Postgres password: fix DATABASE_URL in server/.env');
      if (err.code === 'ECONNREFUSED') console.error('  PostgreSQL is not running (or not on port 5432).');
      process.exit(1);
    });
}
