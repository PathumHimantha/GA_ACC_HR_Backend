const mainDb = require("../db/mainDb");
const logger = require("../utils/logger");

// ── Utility: Format date to YYYY-MM-DD ────────────────────────
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ── Utility: Add weeks to a date ──────────────────────────────
const addWeeks = (date, weeks) => {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
};

// ── Utility: Add days to a date ───────────────────────────────
const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

// ── Utility: Round to 2 decimals ──────────────────────────────
const round2 = (num) => Math.round(num * 100) / 100;

// ── CREATE TABLES IF NOT EXISTS ───────────────────────────────
const initTables = async () => {
  try {
    await mainDb.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bcode VARCHAR(20) NOT NULL,
        ccode VARCHAR(20) NOT NULL,
        ex_name VARCHAR(100) NOT NULL,
        customer_code VARCHAR(50) NOT NULL,
        loan_code VARCHAR(50) NOT NULL UNIQUE,
        loan_amount DECIMAL(12,2) NOT NULL,
        loan_date DATE NOT NULL,
        due_date DATE NOT NULL,
        loan_period INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_bcode (bcode),
        INDEX idx_ccode (ccode),
        INDEX idx_customer_code (customer_code),
        INDEX idx_loan_code (loan_code),
        INDEX idx_loan_date (loan_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await mainDb.query(`
      CREATE TABLE IF NOT EXISTS loan_interest (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bcode VARCHAR(20) NOT NULL,
        ccode VARCHAR(20) NOT NULL,
        ex_name VARCHAR(100) NOT NULL,
        customer_code VARCHAR(50) NOT NULL,
        loan_code VARCHAR(50) NOT NULL,
        week_no INT NOT NULL,
        week_payment DECIMAL(12,2) NOT NULL,
        capital DECIMAL(12,2) NOT NULL,
        interest DECIMAL(12,2) NOT NULL,
        payments DECIMAL(12,2) DEFAULT 0.00,
        payment_date DATE DEFAULT NULL,
        due_date DATE NOT NULL,
        status ENUM('pending','paid','partial','overdue') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_loan_code (loan_code),
        INDEX idx_customer_code (customer_code),
        INDEX idx_bcode (bcode),
        INDEX idx_due_date (due_date),
        INDEX idx_status (status),
        UNIQUE KEY unique_loan_week (loan_code, week_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    logger.info("Loan tables initialized successfully");
  } catch (error) {
    logger.error("Error initializing loan tables:", error);
  }
};

// Initialize tables on module load
initTables();

// ══════════════════════════════════════════════════════════════
// MAIN FUNCTION: Calculate and Save Loan
// ══════════════════════════════════════════════════════════════
exports.calculateAndSaveLoan = async (data) => {
  const {
    bcode,
    ccode,
    ex_name,
    customer_code,
    loan_code,
    loan_amount,
    loan_date,
    loan_period,
  } = data;

  // ── Validation ──────────────────────────────────────────────
  if (
    !bcode ||
    !ccode ||
    !ex_name ||
    !customer_code ||
    !loan_code ||
    !loan_amount ||
    !loan_date ||
    !loan_period
  ) {
    throw new Error(
      "All fields are required: bcode, ccode, ex_name, customer_code, loan_code, loan_amount, loan_date, loan_period",
    );
  }

  const principal = parseFloat(loan_amount);
  const period = parseInt(loan_period);

  if (isNaN(principal) || principal <= 0) {
    throw new Error("Invalid loan amount");
  }

  if (isNaN(period) || period <= 0) {
    throw new Error("Invalid loan period");
  }

  // ── Calculations ─────────────────────────────────────────────
  // Interest calculation: 30% of principal over the period
  // Example: 10,000 loan → 13,000 total over 13 weeks → 1,000 per week
  const interestRate = 0.3; // 30% total interest
  const totalInterest = round2(principal * interestRate);
  const totalPayable = round2(principal + totalInterest);

  // Weekly payment: 10% of principal (for 13 weeks = 30% interest)
  // For period p: weekly = totalPayable / period
  const weeklyPayment = round2(totalPayable / period);

  // Weekly capital and interest breakdown
  const weeklyCapital = round2(principal / period);
  const weeklyInterest = round2(totalInterest / period);

  // Calculate due date (loan_date + period weeks + 1 day buffer)
  const dueDate = addDays(addWeeks(loan_date, period), 1);
  const formattedDueDate = formatDate(dueDate);
  const formattedLoanDate = formatDate(loan_date);

  logger.info(
    `Calculating loan: ${loan_code} | Principal: ${principal} | Total: ${totalPayable} | Weekly: ${weeklyPayment} | Period: ${period}`,
  );

  // ── Get database connection for transaction ──────────────────
  const connection = await mainDb.getConnection();

  try {
    await connection.beginTransaction();

    // ── STEP 1: Insert into loans table ────────────────────────
    const loanInsertQuery = `
      INSERT INTO loans (
        bcode, ccode, ex_name, customer_code, loan_code,
        loan_amount, loan_date, due_date, loan_period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        bcode = VALUES(bcode),
        ccode = VALUES(ccode),
        ex_name = VALUES(ex_name),
        customer_code = VALUES(customer_code),
        loan_amount = VALUES(loan_amount),
        loan_date = VALUES(loan_date),
        due_date = VALUES(due_date),
        loan_period = VALUES(loan_period)
    `;

    await connection.query(loanInsertQuery, [
      bcode,
      ccode,
      ex_name,
      customer_code,
      loan_code,
      principal,
      formattedLoanDate,
      formattedDueDate,
      period,
    ]);

    logger.info(`Loan record inserted: ${loan_code}`);

    // ── STEP 2: Delete existing interest records for this loan ─
    await connection.query("DELETE FROM loan_interest WHERE loan_code = ?", [
      loan_code,
    ]);

    // ── STEP 3: Insert weekly loan_interest records ────────────
    const interestInsertQuery = `
      INSERT INTO loan_interest (
        bcode, ccode, ex_name, customer_code, loan_code,
        week_no, week_payment, capital, interest, payments, due_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const weeklyRecords = [];
    let cumulativeCapital = 0;
    let cumulativeInterest = 0;

    for (let week = 1; week <= period; week++) {
      // Calculate this week's capital and interest
      let weekCapital = round2(principal / period);
      let weekInterest = round2(totalInterest / period);

      // Handle rounding on last week - adjust to match exact totals
      if (week === period) {
        weekCapital = round2(principal - cumulativeCapital);
        weekInterest = round2(totalInterest - cumulativeInterest);
      }

      cumulativeCapital = round2(cumulativeCapital + weekCapital);
      cumulativeInterest = round2(cumulativeInterest + weekInterest);

      const weekPaymentAmount = round2(weekCapital + weekInterest);
      const weekDueDate = formatDate(addWeeks(loan_date, week));

      const values = [
        bcode,
        ccode,
        ex_name,
        customer_code,
        loan_code,
        week,
        weekPaymentAmount,
        weekCapital,
        weekInterest,
        0.0, // payments initially 0
        weekDueDate,
      ];

      await connection.query(interestInsertQuery, values);

      weeklyRecords.push({
        week_no: week,
        week_payment: weekPaymentAmount,
        capital: weekCapital,
        interest: weekInterest,
        due_date: weekDueDate,
      });
    }

    logger.info(
      `Inserted ${weeklyRecords.length} weekly interest records for loan: ${loan_code}`,
    );

    await connection.commit();

    return {
      success: true,
      message: "Loan and interest schedule created successfully",
      data: {
        loan: {
          bcode,
          ccode,
          ex_name,
          customer_code,
          loan_code,
          loan_amount: principal,
          loan_date: formattedLoanDate,
          due_date: formattedDueDate,
          loan_period: period,
        },
        calculation: {
          principal,
          total_interest: totalInterest,
          total_payable: totalPayable,
          weekly_payment: weeklyPayment,
          weekly_capital: weeklyCapital,
          weekly_interest: weeklyInterest,
        },
        schedule: weeklyRecords,
      },
    };
  } catch (error) {
    await connection.rollback();
    logger.error(`Error saving loan ${loan_code}:`, error);
    throw new Error(`Failed to save loan: ${error.message}`);
  } finally {
    connection.release();
  }
};

// ══════════════════════════════════════════════════════════════
// HELPER FUNCTION 1: Insert Single Loan Record
// ══════════════════════════════════════════════════════════════
exports.insertLoanRecord = async (loanData) => {
  const {
    bcode,
    ccode,
    ex_name,
    customer_code,
    loan_code,
    loan_amount,
    loan_date,
    due_date,
    loan_period,
  } = loanData;

  try {
    const query = `
      INSERT INTO loans (
        bcode, ccode, ex_name, customer_code, loan_code,
        loan_amount, loan_date, due_date, loan_period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        bcode = VALUES(bcode),
        ccode = VALUES(ccode),
        ex_name = VALUES(ex_name),
        customer_code = VALUES(customer_code),
        loan_amount = VALUES(loan_amount),
        loan_date = VALUES(loan_date),
        due_date = VALUES(due_date),
        loan_period = VALUES(loan_period)
    `;

    const [result] = await mainDb.query(query, [
      bcode,
      ccode,
      ex_name,
      customer_code,
      loan_code,
      loan_amount,
      formatDate(loan_date),
      formatDate(due_date),
      loan_period,
    ]);

    return {
      success: true,
      message: "Loan record inserted successfully",
      insertId: result.insertId,
      affectedRows: result.affectedRows,
    };
  } catch (error) {
    logger.error("Error inserting loan record:", error);
    throw error;
  }
};

// ══════════════════════════════════════════════════════════════
// HELPER FUNCTION 2: Insert Weekly Loan Interest Records
// ══════════════════════════════════════════════════════════════
exports.insertLoanInterestRecords = async (interestData) => {
  const {
    bcode,
    ccode,
    ex_name,
    customer_code,
    loan_code,
    loan_amount,
    loan_date,
    loan_period,
  } = interestData;

  const principal = parseFloat(loan_amount);
  const period = parseInt(loan_period);
  const totalInterest = round2(principal * 0.3);

  const connection = await mainDb.getConnection();

  try {
    await connection.beginTransaction();

    // Delete existing interest records
    await connection.query("DELETE FROM loan_interest WHERE loan_code = ?", [
      loan_code,
    ]);

    // Insert new records
    const insertQuery = `
      INSERT INTO loan_interest (
        bcode, ccode, ex_name, customer_code, loan_code,
        week_no, week_payment, capital, interest, payments, due_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    let cumulativeCapital = 0;
    let cumulativeInterest = 0;
    const insertedRecords = [];

    for (let week = 1; week <= period; week++) {
      let weekCapital = round2(principal / period);
      let weekInterest = round2(totalInterest / period);

      // Adjust last week for rounding
      if (week === period) {
        weekCapital = round2(principal - cumulativeCapital);
        weekInterest = round2(totalInterest - cumulativeInterest);
      }

      cumulativeCapital = round2(cumulativeCapital + weekCapital);
      cumulativeInterest = round2(cumulativeInterest + weekInterest);

      const weekPaymentAmount = round2(weekCapital + weekInterest);
      const weekDueDate = formatDate(addWeeks(loan_date, week));

      const [result] = await connection.query(insertQuery, [
        bcode,
        ccode,
        ex_name,
        customer_code,
        loan_code,
        week,
        weekPaymentAmount,
        weekCapital,
        weekInterest,
        0.0,
        weekDueDate,
      ]);

      insertedRecords.push({
        id: result.insertId,
        week_no: week,
        week_payment: weekPaymentAmount,
        capital: weekCapital,
        interest: weekInterest,
        due_date: weekDueDate,
      });
    }

    await connection.commit();

    return {
      success: true,
      message: `Inserted ${insertedRecords.length} weekly interest records`,
      records: insertedRecords,
    };
  } catch (error) {
    await connection.rollback();
    logger.error("Error inserting loan interest records:", error);
    throw error;
  } finally {
    connection.release();
  }
};

// ══════════════════════════════════════════════════════════════
// GET: All Loans with Filters
// ══════════════════════════════════════════════════════════════
exports.getAllLoans = async (filters = {}) => {
  const { bcode, ccode, ex_name, customer_code, month, year } = filters;

  let query = `
    SELECT 
      l.*,
      (SELECT COUNT(*) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_weeks,
      (SELECT COALESCE(SUM(li.payments), 0) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_paid,
      (SELECT COALESCE(SUM(li.week_payment), 0) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_payable
    FROM loans l
    WHERE 1=1
  `;

  const params = [];

  if (bcode) {
    query += " AND l.bcode = ?";
    params.push(bcode);
  }
  if (ccode) {
    query += " AND l.ccode = ?";
    params.push(ccode);
  }
  if (ex_name) {
    query += " AND l.ex_name LIKE ?";
    params.push(`%${ex_name}%`);
  }
  if (customer_code) {
    query += " AND l.customer_code = ?";
    params.push(customer_code);
  }
  if (month && year) {
    query += " AND MONTH(l.loan_date) = ? AND YEAR(l.loan_date) = ?";
    params.push(month, year);
  } else if (month) {
    query += " AND DATE_FORMAT(l.loan_date, '%Y-%m') = ?";
    params.push(month);
  }

  query += " ORDER BY l.loan_date DESC, l.id DESC";

  const [rows] = await mainDb.query(query, params);

  return {
    success: true,
    count: rows.length,
    data: Array.isArray(rows) ? rows : rows ? [rows] : [],
  };
};

// ══════════════════════════════════════════════════════════════
// GET: Loan Details with Interest Schedule
// ══════════════════════════════════════════════════════════════
exports.getLoanDetails = async (loan_code) => {
  if (!loan_code) {
    throw new Error("loan_code is required");
  }

  const [loanRows] = await mainDb.query(
    "SELECT * FROM loans WHERE loan_code = ?",
    [loan_code],
  );

  const loan =
    Array.isArray(loanRows) && loanRows.length > 0 ? loanRows[0] : null;

  if (!loan) {
    return {
      success: false,
      message: "Loan not found",
      data: null,
    };
  }

  const [interestRows] = await mainDb.query(
    `SELECT * FROM loan_interest 
     WHERE loan_code = ? 
     ORDER BY week_no ASC`,
    [loan_code],
  );

  const schedule = Array.isArray(interestRows) ? interestRows : [];

  const totalPaid = schedule.reduce(
    (sum, r) => sum + parseFloat(r.payments || 0),
    0,
  );
  const totalPayable = schedule.reduce(
    (sum, r) => sum + parseFloat(r.week_payment || 0),
    0,
  );
  const totalCapital = schedule.reduce(
    (sum, r) => sum + parseFloat(r.capital || 0),
    0,
  );
  const totalInterest = schedule.reduce(
    (sum, r) => sum + parseFloat(r.interest || 0),
    0,
  );

  return {
    success: true,
    data: {
      loan,
      schedule,
      summary: {
        total_paid: round2(totalPaid),
        total_payable: round2(totalPayable),
        total_capital: round2(totalCapital),
        total_interest: round2(totalInterest),
        balance: round2(totalPayable - totalPaid),
        paid_weeks: schedule.filter((r) => r.status === "paid").length,
        pending_weeks: schedule.filter((r) => r.status === "pending").length,
      },
    },
  };
};

// ══════════════════════════════════════════════════════════════
// GET: Loans by Customer
// ══════════════════════════════════════════════════════════════
exports.getLoansByCustomer = async (customer_code) => {
  if (!customer_code) {
    throw new Error("customer_code is required");
  }

  const [rows] = await mainDb.query(
    `SELECT 
      l.*,
      (SELECT COALESCE(SUM(li.payments), 0) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_paid,
      (SELECT COALESCE(SUM(li.week_payment), 0) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_payable
    FROM loans l
    WHERE l.customer_code = ?
    ORDER BY l.loan_date DESC`,
    [customer_code],
  );

  return {
    success: true,
    count: rows.length,
    data: Array.isArray(rows) ? rows : rows ? [rows] : [],
  };
};

// ══════════════════════════════════════════════════════════════
// GET: Loans by Branch
// ══════════════════════════════════════════════════════════════
exports.getLoansByBranch = async (bcode) => {
  if (!bcode) {
    throw new Error("bcode is required");
  }

  const [rows] = await mainDb.query(
    `SELECT 
      l.*,
      (SELECT COALESCE(SUM(li.payments), 0) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_paid,
      (SELECT COALESCE(SUM(li.week_payment), 0) FROM loan_interest li WHERE li.loan_code = l.loan_code) AS total_payable
    FROM loans l
    WHERE l.bcode = ?
    ORDER BY l.loan_date DESC`,
    [bcode],
  );

  return {
    success: true,
    count: rows.length,
    data: Array.isArray(rows) ? rows : rows ? [rows] : [],
  };
};

// ══════════════════════════════════════════════════════════════
// GET: Loan Summary Statistics
// ══════════════════════════════════════════════════════════════
exports.getLoanSummary = async (filters = {}) => {
  const { bcode, month, year } = filters;

  let query = `
    SELECT 
      COUNT(*) AS total_loans,
      COALESCE(SUM(loan_amount), 0) AS total_principal,
      COALESCE(AVG(loan_amount), 0) AS avg_loan_amount,
      COALESCE(SUM(loan_period), 0) AS total_weeks
    FROM loans
    WHERE 1=1
  `;

  const params = [];

  if (bcode) {
    query += " AND bcode = ?";
    params.push(bcode);
  }
  if (month && year) {
    query += " AND MONTH(loan_date) = ? AND YEAR(loan_date) = ?";
    params.push(month, year);
  } else if (month) {
    query += " AND DATE_FORMAT(loan_date, '%Y-%m') = ?";
    params.push(month);
  }

  const [rows] = await mainDb.query(query, params);
  const summary =
    Array.isArray(rows) && rows.length > 0
      ? rows[0]
      : {
          total_loans: 0,
          total_principal: 0,
          avg_loan_amount: 0,
          total_weeks: 0,
        };

  // Get interest totals
  let interestQuery = `
    SELECT 
      COALESCE(SUM(payments), 0) AS total_collected,
      COALESCE(SUM(week_payment), 0) AS total_due,
      COALESCE(SUM(capital), 0) AS total_capital,
      COALESCE(SUM(interest), 0) AS total_interest
    FROM loan_interest
    WHERE 1=1
  `;

  const interestParams = [];

  if (bcode) {
    interestQuery += " AND bcode = ?";
    interestParams.push(bcode);
  }

  const [interestRows] = await mainDb.query(interestQuery, interestParams);
  const interestSummary =
    Array.isArray(interestRows) && interestRows.length > 0
      ? interestRows[0]
      : {
          total_collected: 0,
          total_due: 0,
          total_capital: 0,
          total_interest: 0,
        };

  return {
    success: true,
    data: {
      loans: summary,
      interest: interestSummary,
      outstanding: round2(
        parseFloat(interestSummary.total_due || 0) -
          parseFloat(interestSummary.total_collected || 0),
      ),
    },
  };
};

// ══════════════════════════════════════════════════════════════
// DELETE: Loan and Its Interest Records
// ══════════════════════════════════════════════════════════════
exports.deleteLoan = async (loan_code) => {
  if (!loan_code) {
    throw new Error("loan_code is required");
  }

  const connection = await mainDb.getConnection();

  try {
    await connection.beginTransaction();

    // Delete interest records first
    await connection.query("DELETE FROM loan_interest WHERE loan_code = ?", [
      loan_code,
    ]);

    // Delete loan record
    const [result] = await connection.query(
      "DELETE FROM loans WHERE loan_code = ?",
      [loan_code],
    );

    await connection.commit();

    return {
      success: true,
      message: "Loan and interest records deleted successfully",
      affectedRows: result.affectedRows,
    };
  } catch (error) {
    await connection.rollback();
    logger.error("Error deleting loan:", error);
    throw error;
  } finally {
    connection.release();
  }
};

// ── Export utilities for testing ─────────────────────────────
exports._utils = {
  formatDate,
  addWeeks,
  addDays,
  round2,
};
