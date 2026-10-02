const { mainPool } = require("../config/db");
const logger = require("../utils/logger");

async function query(sql, params = []) {
  try {
    const [rows] = await mainPool.query(sql, params);
    return rows;
  } catch (err) {
    logger.error("mainDb query failed:", { sql, error: err.message });
    throw err;
  }
}

async function transaction(fn) {
  const conn = await mainPool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn({
      query: async (sql, params = []) => {
        const [rows] = await conn.query(sql, params);
        return rows;
      },
    });
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { query, transaction };
