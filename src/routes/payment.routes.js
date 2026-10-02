const express = require("express");
const paymentController = require("../controllers/payment.controller");

const router = express.Router();

// ── Single Payment ────────────────────────────────────────────
// POST /api/payment/single
// Body: { bcode, ccode, customer_code, loan_code, payment_amount, payment_date }
router.post("/single", paymentController.singlePayment);

// ── Bulk Payment ──────────────────────────────────────────────
// POST /api/payment/bulk
// Body: { payments: [ { bcode, ccode, customer_code, loan_code, payment_amount, payment_date } ] }
router.post("/bulk", paymentController.bulkPayment);

// ── Get Payment History for a Loan ────────────────────────────
// GET /api/payment/history/:loan_code
router.get("/history/:loan_code", paymentController.getPaymentHistory);

// ── Get Payment Summary for a Loan ────────────────────────────
// GET /api/payment/summary/:loan_code
router.get("/summary/:loan_code", paymentController.getPaymentSummary);

module.exports = router;
