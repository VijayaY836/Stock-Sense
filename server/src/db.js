import pg from 'pg';
import { config } from './config.js';

// Return NUMERIC columns as JS numbers (quantities are NUMERIC(14,3), safe as doubles)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Return DATE columns as 'YYYY-MM-DD' strings, not timezone-shifted Date objects
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

/**
 * Run `fn` inside a single database transaction.
 * Everything commits together or nothing does.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
