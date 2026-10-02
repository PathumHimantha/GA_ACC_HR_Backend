const mysql = require("mysql2/promise");
const env = require("./env");
const logger = require("../utils/logger");

function createPool(name, config) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 10000,
    dateStrings: false,
  });

  pool.on("connection", () => {
    logger.info(`[${name}] new connection established`);
  });

  pool.on("error", (err) => {
    logger.error(`[${name}] pool error: ${err.message}`);
  });

  return pool;
}

const mainPool = createPool("MAIN_DB", env.mainDb);
const adminPool = createPool("ADMIN_DB", env.adminDb);

async function healthCheck(pool, name) {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return { name, ok: true };
  } catch (err) {
    logger.error(`[${name}] health check failed: ${err.message}`);
    return { name, ok: false, error: err.message };
  }
}

async function checkAllConnections() {
  return Promise.all([
    healthCheck(mainPool, "MAIN_DB"),
    healthCheck(adminPool, "ADMIN_DB"),
  ]);
}

async function closeAll() {
  await Promise.allSettled([mainPool.end(), adminPool.end()]);
  logger.info("All database pools closed.");
}

module.exports = {
  mainPool,
  adminPool,
  checkAllConnections,
  closeAll,
};
