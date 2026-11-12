const { Pool, types } = require('pg');

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' (sin conversiones de zona horaria)
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const query = (text, params) => pool.query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function esperarBD(intentos = 30) {
  for (let i = 1; i <= intentos; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      console.log(`Esperando a la base de datos (${i}/${intentos})…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('No se pudo conectar con la base de datos');
}

module.exports = { pool, query, tx, esperarBD };
