const logger = require("../utils/logger");

module.exports = function requestLogger(req, res, next) {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
};
