const expensesService = require("../services/expenses.service");
const asyncHandler = require("../utils/asyncHandler");

exports.getBranchExpenses = asyncHandler(async (req, res) => {
  const { month, type = "company", branch } = req.query;
  const result = await expensesService.getBranchExpenses(month, type, branch);
  res.json(result);
});

exports.getDeathSettlements = asyncHandler(async (req, res) => {
  const { month, type = "company", branch } = req.query;
  const result = await expensesService.getDeathSettlements(month, type, branch);
  res.json(result);
});
