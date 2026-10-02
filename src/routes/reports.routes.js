const express = require("express");
const reportsController = require("../controllers/reports.controller");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/executive-summary", auth, reportsController.getExecutiveSummary);

module.exports = router;
