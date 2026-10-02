require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",

  mainDb: {
    host: required("MAIN_DB_HOST"),
    port: Number(process.env.MAIN_DB_PORT || 3306),
    user: required("MAIN_DB_USER"),
    password: required("MAIN_DB_PASSWORD"),
    database: required("MAIN_DB_NAME"),
  },

  adminDb: {
    host: required("ADMIN_DB_HOST"),
    port: Number(process.env.ADMIN_DB_PORT || 3306),
    user: required("ADMIN_DB_USER"),
    password: required("ADMIN_DB_PASSWORD"),
    database: required("ADMIN_DB_NAME"),
  },
};
