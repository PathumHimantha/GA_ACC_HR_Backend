const incomeService = require("../services/income.service");
const asyncHandler = require("../utils/asyncHandler");

exports.getOtherIncome = asyncHandler(async (req, res) => {
  const { month, type } = req.query;
  const result = await incomeService.getOtherIncome(month, type);
  res.json(result);
});

exports.getInterestIncome = asyncHandler(async (req, res) => {
  const { month, type = "company" } = req.query;
  const result = await incomeService.getInterestIncome(month, type);
  res.json(result);
});
