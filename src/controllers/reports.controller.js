const reportsService = require("../services/reports.service");
const asyncHandler = require("../utils/asyncHandler");

exports.getExecutiveSummary = asyncHandler(async (req, res) => {
  const { execName, date } = req.query;
  const result = await reportsService.getExecutiveSummary(
    execName,
    date,
    req.user.id,
  );
  res.json(result);
});
