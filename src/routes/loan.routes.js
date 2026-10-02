const express = require("express");
const loanController = require("../controllers/loan.controller");

const router = express.Router();

// POST /api/loan/calculate-and-save - Calculate and insert loan + loan_interest records
router.post(
  "/calculate-and-save",
  (req, res, next) => {
    console.log("=== LOAN ROUTE HIT ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Method:", req.method);
    console.log("URL:", req.originalUrl);
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));
    console.log("Body Type:", typeof req.body);
    console.log("Body Keys:", Object.keys(req.body || {}));
    console.log("Query:", JSON.stringify(req.query, null, 2));
    console.log("Params:", JSON.stringify(req.params, null, 2));
    console.log("======================");
    next();
  },
  loanController.calculateAndSaveLoan,
);

// GET /api/loan/all - Get all loans with filters
router.get("/all", loanController.getAllLoans);

// GET /api/loan/details/:loan_code - Get specific loan details with interest schedule
router.get("/details/:loan_code", loanController.getLoanDetails);

// GET /api/loan/by-customer/:customer_code - Get loans by customer
router.get("/by-customer/:customer_code", loanController.getLoansByCustomer);

// GET /api/loan/by-branch/:bcode - Get loans by branch
router.get("/by-branch/:bcode", loanController.getLoansByBranch);

// GET /api/loan/summary - Get loan summary statistics
router.get("/summary", loanController.getLoanSummary);

// DELETE /api/loan/:loan_code - Delete loan and its interest records
router.delete("/:loan_code", loanController.deleteLoan);

module.exports = router;
