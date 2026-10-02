const express = require("express");
const cors = require("cors");
const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");
const requestLogger = require("./middleware/requestLogger");
const { checkAllConnections } = require("./config/db");

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get("/health", async (req, res) => {
  const dbStatus = await checkAllConnections();
  const allOk = dbStatus.every((db) => db.ok);
  res.status(allOk ? 200 : 503).json({ ok: allOk, databases: dbStatus });
});

app.use("/api", routes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(errorHandler);

module.exports = app;
