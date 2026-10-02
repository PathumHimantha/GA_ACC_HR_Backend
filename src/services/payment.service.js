const mainDb = require("../db/mainDb");
const adminDb = require("../db/adminDb");
const logger = require("../utils/logger");

// ── Utility: Round to 2 decimals ──────────────────────────────
const round2 = (num) => Math.round(num * 100) / 100;

// ── Utility: Format date to YYYY-MM-DD ────────────────────────
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ══════════════════════════════════════════════════════════════
// INTERNAL: Process Payment Against Loan Interest Rows
// ══════════════════════════════════════════════════════════════
// This function does the actual allocation of a payment across
// one or more pending weeks within a transaction.
//
// It returns a summary of what was allocated.
//
// Allocation logic per week:
//   1. Get the pending week's "capital" and "interest" values
//   2. Take capital first, then interest (you can flip this)
//   3. Update the row with:
//        payments         = week_payment (full amount) when fully paid
//        interest_payment = amount allocated to interest
//        capital_payment  = amount allocated to capital
//        payment_date     = date of payment
//        status           = 'paid' | 'partial'
// ══════════════════════════════════════════════════════════════
const allocatePaymentToWeeks = async (conn, params) => {
  const {
    bcode,
    ccode,
    customer_code,
    loan_code,
    payment_amount,
    payment_date,
  } = params;

  const amount = parseFloat(payment_amount);
  const formattedDate = formatDate(payment_date);

  if (isNaN(amount) || amount <= 0) {
    throw new Error("Invalid payment amount");
  }

  // ── Fetch pending weeks (oldest due_date first) ─────────────
  const weeks = await conn.query(
    `SELECT 
      id, week_no, week_payment, capital, interest,
      payments, interest_payment, capital_payment, due_date, status
    FROM loan_interest
    WHERE loan_code = ? AND bcode = ? AND ccode = ?
      AND status IN ('pending', 'partial')
    ORDER BY week_no ASC`,
    [loan_code, bcode, ccode],
  );

  if (!weeks || weeks.length === 0) {
    throw new Error(`No pending weeks found for loan ${loan_code}`);
  }

  let remaining = amount;
  const allocations = [];

  for (const week of weeks) {
    if (remaining <= 0) break;

    // How much of this week is already paid?
    const alreadyPaid = parseFloat(week.payments) || 0;
    const weekTotal = parseFloat(week.week_payment);
    const weekCapital = parseFloat(week.capital);
    const weekInterest = parseFloat(week.interest);

    // How much is still owed on this week?
    const stillOwed = round2(weekTotal - alreadyPaid);
    if (stillOwed <= 0) continue;

    // Amount to apply to this week (min of remaining and stillOwed)
    const amountForThisWeek = round2(Math.min(remaining, stillOwed));

    // Split this amount between capital & interest
    // Proportional split based on what's left owed
    const capitalAlreadyPaid = parseFloat(week.capital_payment) || 0;
    const interestAlreadyPaid = parseFloat(week.interest_payment) || 0;
    const capitalStillOwed = round2(weekCapital - capitalAlreadyPaid);
    const interestStillOwed = round2(weekInterest - interestAlreadyPaid);

    let capitalThisTime = 0;
    let interestThisTime = 0;

    if (amountForThisWeek >= stillOwed) {
      // Fully paying off the week
      capitalThisTime = capitalStillOwed;
      interestThisTime = interestStillOwed;
    } else {
      // Partial payment - allocate proportionally based on what's still owed
      const totalStillOwed = round2(capitalStillOwed + interestStillOwed);
      if (totalStillOwed > 0) {
        capitalThisTime = round2(
          (capitalStillOwed / totalStillOwed) * amountForThisWeek,
        );
        interestThisTime = round2(amountForThisWeek - capitalThisTime);
      }
    }

    const newTotalPaid = round2(alreadyPaid + amountForThisWeek);
    const newCapitalPaid = round2(capitalAlreadyPaid + capitalThisTime);
    const newInterestPaid = round2(interestAlreadyPaid + interestThisTime);

    // Determine status
    let newStatus;
    if (newTotalPaid >= weekTotal - 0.01) {
      newStatus = "paid";
    } else if (newTotalPaid > 0) {
      newStatus = "partial";
    } else {
      newStatus = "pending";
    }

    // ── Update the week row ────────────────────────────────────
    await conn.query(
      `UPDATE loan_interest
       SET payments = ?,
           interest_payment = ?,
           capital_payment = ?,
           payment_date = ?,
           status = ?
       WHERE id = ?`,
      [
        newTotalPaid,
        newInterestPaid,
        newCapitalPaid,
        formattedDate,
        newStatus,
        week.id,
      ],
    );

    allocations.push({
      week_id: week.id,
      week_no: week.week_no,
      week_total: weekTotal,
      amount_applied: amountForThisWeek,
      capital_applied: capitalThisTime,
      interest_applied: interestThisTime,
      total_paid_after: newTotalPaid,
      status: newStatus,
      due_date: week.due_date,
    });

    remaining = round2(remaining - amountForThisWeek);
  }

  return {
    total_payment: amount,
    total_allocated: round2(amount - remaining),
    leftover: round2(remaining),
    weeks_paid: allocations.filter((a) => a.status === "paid").length,
    weeks_partial: allocations.filter((a) => a.status === "partial").length,
    allocations,
  };
};

// ══════════════════════════════════════════════════════════════
// PUBLIC: Process Single Payment
// ══════════════════════════════════════════════════════════════
exports.processSinglePayment = async (data) => {
  const {
    bcode,
    ccode,
    customer_code,
    loan_code,
    payment_amount,
    payment_date,
  } = data;

  // ── Validation ─────────────────────────────────────────────
  const missing = [];
  if (!bcode) missing.push("bcode");
  if (!ccode) missing.push("ccode");
  if (!customer_code) missing.push("customer_code");
  if (!loan_code) missing.push("loan_code");
  if (!payment_amount) missing.push("payment_amount");
  if (!payment_date) missing.push("payment_date");

  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  logger.info(
    `Processing single payment: ${loan_code} | Amount: ${payment_amount} | Date: ${payment_date}`,
  );

  const result = await adminDb.transaction(async (conn) => {
    // Verify loan exists
    const loanRows = await conn.query(
      "SELECT * FROM loans WHERE loan_code = ?",
      [loan_code],
    );
    const loan =
      Array.isArray(loanRows) && loanRows.length > 0 ? loanRows[0] : null;

    if (!loan) {
      throw new Error(`Loan ${loan_code} not found`);
    }

    // Allocate payment
    const allocationResult = await allocatePaymentToWeeks(conn, {
      bcode,
      ccode,
      customer_code,
      loan_code,
      payment_amount,
      payment_date,
    });

    // Get updated loan summary
    const summaryRows = await conn.query(
      `SELECT 
        COALESCE(SUM(week_payment), 0) AS total_payable,
        COALESCE(SUM(payments), 0) AS total_paid,
        COUNT(*) AS total_weeks,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_weeks,
        SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial_weeks,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_weeks
      FROM loan_interest WHERE loan_code = ?`,
      [loan_code],
    );
    const summary =
      Array.isArray(summaryRows) && summaryRows.length > 0
        ? summaryRows[0]
        : {};

    return {
      loan,
      allocation: allocationResult,
      summary: {
        total_payable: parseFloat(summary.total_payable || 0),
        total_paid: parseFloat(summary.total_paid || 0),
        balance: round2(
          parseFloat(summary.total_payable || 0) -
            parseFloat(summary.total_paid || 0),
        ),
        total_weeks: parseInt(summary.total_weeks || 0),
        paid_weeks: parseInt(summary.paid_weeks || 0),
        partial_weeks: parseInt(summary.partial_weeks || 0),
        pending_weeks: parseInt(summary.pending_weeks || 0),
      },
    };
  });

  return {
    success: true,
    message: "Payment processed successfully",
    data: {
      loan_code: result.loan.loan_code,
      customer_code: result.loan.customer_code,
      payment_amount: parseFloat(payment_amount),
      payment_date: formatDate(payment_date),
      ...result.allocation,
      loan_summary: result.summary,
    },
  };
};

// ══════════════════════════════════════════════════════════════
// PUBLIC: Process Bulk Payment
// ══════════════════════════════════════════════════════════════
exports.processBulkPayment = async (payments) => {
  if (!Array.isArray(payments) || payments.length === 0) {
    throw new Error("payments must be a non-empty array");
  }

  logger.info(`Processing bulk payment: ${payments.length} records`);

  // Process all payments in a single transaction
  const results = await adminDb.transaction(async (conn) => {
    const output = [];

    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const {
        bcode,
        ccode,
        customer_code,
        loan_code,
        payment_amount,
        payment_date,
      } = p;

      // Validate each
      const missing = [];
      if (!bcode) missing.push("bcode");
      if (!ccode) missing.push("ccode");
      if (!customer_code) missing.push("customer_code");
      if (!loan_code) missing.push("loan_code");
      if (!payment_amount) missing.push("payment_amount");
      if (!payment_date) missing.push("payment_date");

      if (missing.length > 0) {
        output.push({
          index: i,
          loan_code: loan_code || null,
          success: false,
          error: `Missing fields: ${missing.join(", ")}`,
        });
        continue;
      }

      try {
        const allocationResult = await allocatePaymentToWeeks(conn, {
          bcode,
          ccode,
          customer_code,
          loan_code,
          payment_amount,
          payment_date,
        });

        output.push({
          index: i,
          loan_code,
          customer_code,
          payment_amount: parseFloat(payment_amount),
          payment_date: formatDate(payment_date),
          success: true,
          ...allocationResult,
        });
      } catch (err) {
        logger.error(`Bulk payment error at index ${i}:`, err);
        output.push({
          index: i,
          loan_code,
          success: false,
          error: err.message,
        });
      }
    }

    return output;
  });

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    success: failed === 0,
    message: `Processed ${results.length} payments: ${successful} succeeded, ${failed} failed`,
    summary: {
      total: results.length,
      successful,
      failed,
    },
    results,
  };
};

// ══════════════════════════════════════════════════════════════
// PUBLIC: Get Payment History
// ══════════════════════════════════════════════════════════════
exports.getPaymentHistory = async (loan_code) => {
  if (!loan_code) {
    throw new Error("loan_code is required");
  }

  const rows = await adminDb.query(
    `SELECT 
      id, week_no, week_payment, capital, interest,
      payments, payment_date, due_date, income_month,
      interest_payment, capital_payment, status
    FROM loan_interest
    WHERE loan_code = ?
    ORDER BY week_no ASC`,
    [loan_code],
  );

  const schedule = Array.isArray(rows) ? rows : rows ? [rows] : [];

  return {
    success: true,
    loan_code,
    count: schedule.length,
    data: schedule,
  };
};

// ══════════════════════════════════════════════════════════════
// PUBLIC: Get Payment Summary
// ══════════════════════════════════════════════════════════════
exports.getPaymentSummary = async (loan_code) => {
  if (!loan_code) {
    throw new Error("loan_code is required");
  }

  const rows = await adminDb.query(
    `SELECT 
      COALESCE(SUM(week_payment), 0) AS total_payable,
      COALESCE(SUM(payments), 0) AS total_paid,
      COALESCE(SUM(capital), 0) AS total_capital,
      COALESCE(SUM(interest), 0) AS total_interest,
      COALESCE(SUM(capital_payment), 0) AS total_capital_paid,
      COALESCE(SUM(interest_payment), 0) AS total_interest_paid,
      COUNT(*) AS total_weeks,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_weeks,
      SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial_weeks,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_weeks,
      SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_weeks
    FROM loan_interest WHERE loan_code = ?`,
    [loan_code],
  );

  const s = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};

  return {
    success: true,
    loan_code,
    data: {
      total_payable: round2(parseFloat(s.total_payable || 0)),
      total_paid: round2(parseFloat(s.total_paid || 0)),
      balance: round2(
        parseFloat(s.total_payable || 0) - parseFloat(s.total_paid || 0),
      ),
      total_capital: round2(parseFloat(s.total_capital || 0)),
      total_interest: round2(parseFloat(s.total_interest || 0)),
      total_capital_paid: round2(parseFloat(s.total_capital_paid || 0)),
      total_interest_paid: round2(parseFloat(s.total_interest_paid || 0)),
      total_weeks: parseInt(s.total_weeks || 0),
      paid_weeks: parseInt(s.paid_weeks || 0),
      partial_weeks: parseInt(s.partial_weeks || 0),
      pending_weeks: parseInt(s.pending_weeks || 0),
      overdue_weeks: parseInt(s.overdue_weeks || 0),
    },
  };
};
