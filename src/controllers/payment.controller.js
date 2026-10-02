const paymentService = require("../services/payment.service");
const asyncHandler = require("../utils/asyncHandler");

// ── Single Payment ────────────────────────────────────────────
exports.singlePayment = asyncHandler(async (req, res) => {
  const {
    bcode,
    ccode,
    customer_code,
    loan_code,
    payment_amount,
    payment_date,
  } = req.body;

  const result = await paymentService.processSinglePayment({
    bcode,
    ccode,
    customer_code,
    loan_code,
    payment_amount,
    payment_date,
  });

  res.json(result);
});

// ── Bulk Payment ──────────────────────────────────────────────
exports.bulkPayment = asyncHandler(async (req, res) => {
  const { payments } = req.body;

  const result = await paymentService.processBulkPayment(payments);

  res.json(result);
});

// ── Get Payment History ───────────────────────────────────────
exports.getPaymentHistory = asyncHandler(async (req, res) => {
  const { loan_code } = req.params;
  const result = await paymentService.getPaymentHistory(loan_code);
  res.json(result);
});

// ── Get Payment Summary ───────────────────────────────────────
exports.getPaymentSummary = asyncHandler(async (req, res) => {
  const { loan_code } = req.params;
  const result = await paymentService.getPaymentSummary(loan_code);
  res.json(result);
});
