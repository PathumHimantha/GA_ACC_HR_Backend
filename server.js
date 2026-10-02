const app = require("./src/app");
const env = require("./src/config/env");
const logger = require("./src/utils/logger");
const { closeAll, checkAllConnections } = require("./src/config/db");
const {
  startInterestIncomeScheduler,
} = require("./src/jobs/interestIncome.job");
let server;

async function start() {
  const dbStatus = await checkAllConnections();
  dbStatus.forEach((status) => {
    if (!status.ok) {
      logger.error(
        `Startup DB check failed for ${status.name}: ${status.error}`,
      );
    } else {
      logger.info(`Startup DB check passed for ${status.name}`);
    }
  });

  server = app.listen(env.port, () => {
    logger.info(`Server running on port ${env.port} [${env.nodeEnv}]`);
  });
}
startInterestIncomeScheduler();
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  if (!server) {
    process.exit(0);
    return;
  }

  server.close(async (err) => {
    if (err) {
      logger.error("Error while closing server:", err);
      process.exit(1);
      return;
    }

    await closeAll();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled Rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught Exception");
});

start();
