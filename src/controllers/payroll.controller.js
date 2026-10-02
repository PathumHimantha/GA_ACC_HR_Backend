const payrollService = require("../services/payroll.service");
const asyncHandler = require("../utils/asyncHandler");

exports.getemployees = asyncHandler(async (req, res) => {
  const { month, type } = req.query;
  const result = await payrollService.getemployees(month, type);
  res.json(result);
});
