const logger = require("../utils/logger");

module.exports = function errorHandler(err, req, res, next) {
  logger.error("Unhandled error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
  });

  const status = err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
  });
};
