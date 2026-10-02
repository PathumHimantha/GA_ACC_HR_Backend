const express = require("express");
const payrollController = require("../controllers/payroll.controller");

const router = express.Router();

router.get("/employees", payrollController.getemployees);

module.exports = router;
