const express = require("express");
const authRoutes = require("./auth.routes");
const usersRoutes = require("./users.routes");
const reportsRoutes = require("./reports.routes");
const incomeRoutes = require("./income.routes");
const expensesRoutes = require("./expenses.route");
const payrollRoutes = require("./payroll.routes");
const loanRoutes = require("./loan.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/reports", reportsRoutes);
router.use("/income", incomeRoutes);
router.use("/expenses", expensesRoutes);
router.use("/payroll", payrollRoutes);
router.use("/loan", loanRoutes);

module.exports = router;
