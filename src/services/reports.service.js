const mainDb = require("../db/mainDb");
const adminDb = require("../db/adminDb");

async function getExecutiveSummary(execName, date, userId) {
  const loans = await mainDb.query(
    `SELECT loan_category, loan_amount FROM customer WHERE name = ? AND DATE(loan_date) = ?`,
    [execName, date],
  );

  await adminDb.query(
    `INSERT INTO admin_audit_log (action, performed_by, created_at) VALUES (?, ?, NOW())`,
    ["view_executive_summary", userId || "system"],
  );

  return { loans };
}

module.exports = { getExecutiveSummary };
