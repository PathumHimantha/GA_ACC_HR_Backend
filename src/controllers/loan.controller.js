const loanService = require("../services/loan.service");
const asyncHandler = require("../utils/asyncHandler");

exports.calculateAndSaveLoan = asyncHandler(async (req, res) => {
  const {
    bcode,
    ccode,
    ex_name,
    customer_code,
    loan_code,
    loan_amount,
    loan_date,
    loan_period,
  } = req.body;

  const result = await loanService.calculateAndSaveLoan({
    bcode,
    ccode,
    ex_name,
    customer_code,
    loan_code,
    loan_amount,
    loan_date,
    loan_period,
  });

  res.json(result);
});

exports.getAllLoans = asyncHandler(async (req, res) => {
  const { bcode, ccode, ex_name, customer_code, month, year, loan_type } =
    req.query;

  const result = await loanService.getAllLoans({
    bcode,
    ccode,
    ex_name,
    customer_code,
    month,
    year,
    loan_type,
  });
  res.json(result);
});

exports.getLoanDetails = asyncHandler(async (req, res) => {
  const { loan_code } = req.params;
  const result = await loanService.getLoanDetails(loan_code);
  res.json(result);
});

exports.getLoansByCustomer = asyncHandler(async (req, res) => {
  const { customer_code } = req.params;
  const result = await loanService.getLoansByCustomer(customer_code);
  res.json(result);
});

exports.getLoansByBranch = asyncHandler(async (req, res) => {
  const { bcode } = req.params;
  const result = await loanService.getLoansByBranch(bcode);
  res.json(result);
});

exports.getLoanSummary = asyncHandler(async (req, res) => {
  const { bcode, month, year } = req.query;
  const result = await loanService.getLoanSummary({ bcode, month, year });
  res.json(result);
});

exports.deleteLoan = asyncHandler(async (req, res) => {
  const { loan_code } = req.params;
  const result = await loanService.deleteLoan(loan_code);
  res.json(result);
});
