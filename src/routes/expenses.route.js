const express = require("express");
const expensesController = require("../controllers/expenses.controller");

const router = express.Router();

router.get("/branch_expenses", expensesController.getBranchExpenses);
router.get("/death-settlements", expensesController.getDeathSettlements);
module.exports = router;
