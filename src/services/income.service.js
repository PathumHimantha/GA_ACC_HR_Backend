const mainDb = require("../db/mainDb");
const adminDb = require("../db/adminDb");
const logger = require("../utils/logger");

const DEFAULT_INTEREST_RATE = 0.3; // 30%
const DEFAULT_LOAN_PERIOD = 13; // weeks

async function getOtherIncome(month, type) {
  if (!month) {
    const error = new Error("month query parameter is required");
    error.statusCode = 400;
    throw error;
  }

  // Branch wise report
  if (type === "branch") {
    const rows = await mainDb.query(
      `
      SELECT
        bname AS branch_name,
        COALESCE(SUM(COALESCE(document_fee, 0)), 0) AS document_fee,
        COALESCE(SUM(COALESCE(insurance_fee, 0)), 0) AS insurance_fee,
        COALESCE(
          SUM(
            COALESCE(document_fee, 0) +
            COALESCE(insurance_fee, 0)
          ),
        0) AS total_fee,
        COUNT(*) AS customer_count
      FROM customer
      WHERE DATE_FORMAT(loan_date, '%Y-%m') = ?
      GROUP BY bname
      ORDER BY bname
      `,
      [month],
    );

    return {
      month,
      type,
      data: rows.map((row) => ({
        branch_name: row.branch_name,
        document_fee: Number(row.document_fee || 0),
        insurance_fee: Number(row.insurance_fee || 0),
        total_fee: Number(row.total_fee || 0),
        customer_count: Number(row.customer_count || 0),
      })),
    };
  }
  if (type === "zone") {
    const zoneBranches = await adminDb.query(
      `
    SELECT bcode, zone
    FROM zone_branches
    `,
    );

    const zoneMap = {};

    zoneBranches.forEach((item) => {
      zoneMap[item.bcode] = item.zone;
    });

    const rows = await mainDb.query(
      `
    SELECT
      c.bcode,

      COALESCE(SUM(COALESCE(c.document_fee,0)),0) AS document_fee,

      COALESCE(SUM(COALESCE(c.insurance_fee,0)),0) AS insurance_fee,

      COALESCE(
        SUM(
          COALESCE(c.document_fee,0)
          +
          COALESCE(c.insurance_fee,0)
        ),
      0) AS total_fee,

      COUNT(*) AS customer_count

    FROM customer c

    WHERE DATE_FORMAT(c.loan_date,'%Y-%m') = ?

    GROUP BY c.bcode

    `,
      [month],
    );

    const zones = {};

    rows.forEach((row) => {
      const zone = zoneMap[row.bcode] || "OTHER";

      if (!zones[zone]) {
        zones[zone] = {
          zone_name: `Zone ${zone}`,
          document_fee: 0,
          insurance_fee: 0,
          total_fee: 0,
          customer_count: 0,
        };
      }

      zones[zone].document_fee += Number(row.document_fee);
      zones[zone].insurance_fee += Number(row.insurance_fee);
      zones[zone].total_fee += Number(row.total_fee);
      zones[zone].customer_count += Number(row.customer_count);
    });

    return {
      month,
      type,
      data: Object.values(zones),
    };
  }
  // Default overall summary
  const rows = await mainDb.query(
    `
    SELECT
      COALESCE(SUM(COALESCE(document_fee, 0)), 0) AS document_fee,
      COALESCE(SUM(COALESCE(insurance_fee, 0)), 0) AS insurance_fee,
      COALESCE(
        SUM(
          COALESCE(document_fee, 0) +
          COALESCE(insurance_fee, 0)
        ),
      0) AS total_fee,
      COUNT(*) AS customer_count
    FROM customer
    WHERE DATE_FORMAT(loan_date, '%Y-%m') = ?
    `,
    [month],
  );

  const row = rows[0] || {};

  return {
    month,
    type: type || "",
    document_fee: Number(row.document_fee || 0),
    insurance_fee: Number(row.insurance_fee || 0),
    total_fee: Number(row.total_fee || 0),
    customer_count: Number(row.customer_count || 0),
  };
}

// async function getInterestIncome(month, type) {
//   logger.info(
//     `[InterestIncome] Starting with month=${month}, type=${type || "company"}`,
//   );

//   if (!month) {
//     logger.error("[InterestIncome] Month parameter is missing");
//     const error = new Error("month query parameter is required");
//     error.statusCode = 400;
//     throw error;
//   }

//   try {
//     logger.info(
//       `[InterestIncome] Fetching interest records for month: ${month}`,
//     );

//     // ── Get all interest income records for the month ──
//     const interestRecords = await adminDb.query(
//       `SELECT
//         li.*,
//         b.bname AS branch_name
//       FROM loan_interest_income li
//       LEFT JOIN zone_branches b ON li.bcode = b.bcode
//       WHERE li.income_month = ?
//       ORDER BY li.loan_code`,
//       [month],
//     );

//     logger.info(
//       `[InterestIncome] Found ${interestRecords?.length || 0} interest records`,
//     );

//     if (!interestRecords || interestRecords.length === 0) {
//       logger.warn(
//         `[InterestIncome] No interest records found for month: ${month}`,
//       );
//       return {
//         month,
//         type: type || "company",
//         data: [],
//         summary: {
//           total_interest_expected: 0,
//           total_capital_expected: 0,
//           total_expected: 0,
//           total_interest_paid: 0,
//           total_capital_paid: 0,
//           total_paid: 0,
//           total_interest_debt: 0,
//           total_capital_debt: 0,
//           total_debt: 0,
//           customer_count: 0,
//         },
//       };
//     }

//     // ── Process each loan to get payments ──
//     logger.info(
//       `[InterestIncome] Processing ${interestRecords.length} interest records`,
//     );
//     const processedData = [];

//     for (const record of interestRecords) {
//       try {
//         const loanCode = record.loan_code;
//         logger.debug(`[InterestIncome] Processing loan: ${loanCode}`);

//         const weekPayment = parseFloat(record.week_payment) || 0;
//         const interestPerWeek = parseFloat(record.interest) || 0;
//         const capitalPerWeek = parseFloat(record.capital) || 0;
//         const fullLoanAmount = parseFloat(record.full_loan_amount) || 0;
//         const loanDate = record.loan_date;

//         logger.debug(
//           `[InterestIncome] Loan ${loanCode}: weekPayment=${weekPayment}, interestPerWeek=${interestPerWeek}, capitalPerWeek=${capitalPerWeek}`,
//         );

//         // ── Calculate the number of weeks DUE in this month for this loan ──
//         // Get the loan date, or use the first day of the month if loan_date is null
//         let loanStartDate;
//         if (loanDate) {
//           loanStartDate = new Date(loanDate);
//         } else {
//           loanStartDate = new Date(month + "-01");
//         }
//         loanStartDate.setHours(0, 0, 0, 0);

//         // First day of the requested month
//         const monthStartDate = new Date(month + "-01");
//         monthStartDate.setHours(0, 0, 0, 0);

//         // Last day of the requested month
//         const monthEnd = new Date(month + "-01");
//         monthEnd.setMonth(monthEnd.getMonth() + 1);
//         monthEnd.setDate(0); // Last day of the month
//         monthEnd.setHours(0, 0, 0, 0);
//         const monthEndDate = monthEnd;

//         // ✅ Never calculate "expected" beyond today — a payment isn't due
//         // yet just because the month hasn't ended.
//         const today = new Date();
//         today.setHours(0, 0, 0, 0);
//         const effectiveEndDate = monthEndDate < today ? monthEndDate : today;

//         const MS_PER_DAY = 1000 * 60 * 60 * 24;

//         let weeksInMonth = 0;
//         if (effectiveEndDate >= loanStartDate) {
//           // Total whole due-weeks from loan start up to effectiveEndDate
//           const daysSinceLoanStart = Math.floor(
//             (effectiveEndDate - loanStartDate) / MS_PER_DAY,
//           );
//           const totalDueWeeksSoFar = Math.floor(daysSinceLoanStart / 7);

//           if (loanStartDate >= monthStartDate) {
//             // Loan started within this month — all due weeks so far belong to this month
//             weeksInMonth = totalDueWeeksSoFar;
//           } else {
//             // Loan started before this month — subtract due weeks that
//             // already happened before this month began
//             const dayBeforeMonth = new Date(monthStartDate);
//             dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);
//             const daysSinceLoanStartBeforeMonth = Math.floor(
//               (dayBeforeMonth - loanStartDate) / MS_PER_DAY,
//             );
//             const dueWeeksBeforeMonth =
//               daysSinceLoanStartBeforeMonth >= 0
//                 ? Math.floor(daysSinceLoanStartBeforeMonth / 7)
//                 : 0;
//             weeksInMonth = totalDueWeeksSoFar - dueWeeksBeforeMonth;
//           }
//         }

//         logger.debug(
//           `[InterestIncome] Loan ${loanCode}: loanDate=${loanDate}, weeksInMonth=${weeksInMonth}`,
//         );

//         // ── Get all payments for this loan up to the month end ──
//         const monthEndStr = monthEndDate.toISOString().slice(0, 10);

//         logger.debug(
//           `[InterestIncome] Loan ${loanCode}: Looking for payments before ${monthEndStr}`,
//         );

//         const payments = await mainDb.query(
//           `SELECT
//             SUM(payment) AS total_paid,
//             COUNT(*) AS payment_count,
//             MIN(payment_date) AS first_payment_date,
//             MAX(payment_date) AS last_payment_date
//           FROM payments
//           WHERE loan_code = ?
//             AND payment_date <= ?`,
//           [loanCode, monthEndStr],
//         );

//         const totalPaid = parseFloat(payments[0]?.total_paid) || 0;
//         const paymentCount = parseInt(payments[0]?.payment_count) || 0;

//         logger.debug(
//           `[InterestIncome] Loan ${loanCode}: totalPaid=${totalPaid}, paymentCount=${paymentCount}`,
//         );

//         // ── Calculate expected payments for this month based on actual weeks ──
//         const expectedInterest = interestPerWeek * weeksInMonth;
//         const expectedCapital = capitalPerWeek * weeksInMonth;
//         const expectedTotal = expectedInterest + expectedCapital;

//         logger.debug(
//           `[InterestIncome] Loan ${loanCode}: expectedInterest=${expectedInterest}, expectedCapital=${expectedCapital}, expectedTotal=${expectedTotal}`,
//         );

//         // ── Calculate actual payments ──
//         // How many full weeks were paid?
//         const weeksPaid = Math.floor(totalPaid / weekPayment);
//         const remainingPayment = totalPaid % weekPayment;

//         logger.debug(
//           `[InterestIncome] Loan ${loanCode}: weeksPaid=${weeksPaid}, remainingPayment=${remainingPayment}`,
//         );

//         // Calculate paid amounts
//         let paidInterest = 0;
//         let paidCapital = 0;
//         let debtInterest = 0;
//         let debtCapital = 0;
//         let nextMonthInterest = 0;
//         let nextMonthCapital = 0;
//         let nextMonthAmount = 0;
//         let isOverpaid = false;

//         if (weeksPaid > 0) {
//           paidInterest = interestPerWeek * weeksPaid;
//           paidCapital = capitalPerWeek * weeksPaid;
//         }

//         // Handle remaining payment (partial week or overpayment)
//         if (remainingPayment > 0) {
//           // Check if remaining payment covers the full week
//           if (remainingPayment >= weekPayment) {
//             // Overpayment - pays into next month
//             const extraPayment = remainingPayment - weekPayment;
//             const extraWeeks = Math.floor(extraPayment / weekPayment);
//             const extraRemainder = extraPayment % weekPayment;

//             // Add one more full week
//             paidInterest += interestPerWeek;
//             paidCapital += capitalPerWeek;

//             // Extra weeks go to next month
//             if (extraWeeks > 0) {
//               nextMonthInterest = interestPerWeek * extraWeeks;
//               nextMonthCapital = capitalPerWeek * extraWeeks;
//               nextMonthAmount = nextMonthInterest + nextMonthCapital;
//             }

//             // Handle remainder
//             if (extraRemainder > 0) {
//               const ratio = extraRemainder / weekPayment;
//               nextMonthInterest += interestPerWeek * ratio;
//               nextMonthCapital += capitalPerWeek * ratio;
//               nextMonthAmount += extraRemainder;
//             }

//             isOverpaid = true;
//             logger.debug(
//               `[InterestIncome] Loan ${loanCode}: Overpaid! nextMonthAmount=${nextMonthAmount}`,
//             );
//           } else {
//             // Partial payment - partial week
//             const ratio = remainingPayment / weekPayment;
//             paidInterest += interestPerWeek * ratio;
//             paidCapital += capitalPerWeek * ratio;
//             logger.debug(
//               `[InterestIncome] Loan ${loanCode}: Partial payment. ratio=${ratio}`,
//             );
//           }
//         }

//         // Calculate debt (unpaid amounts)
//         if (totalPaid < expectedTotal) {
//           const debtAmount = expectedTotal - totalPaid;
//           const debtRatio = debtAmount / expectedTotal;
//           debtInterest = expectedInterest * debtRatio;
//           debtCapital = expectedCapital * debtRatio;
//           logger.debug(
//             `[InterestIncome] Loan ${loanCode}: Debt interest=${debtInterest}, debtCapital=${debtCapital}`,
//           );
//         }

//         // ── Get debt breakdown by week ──
//         const debtBreakdown = [];
//         const totalExpectedWeeks = Math.ceil(expectedTotal / weekPayment);
//         const paidWeeks = Math.floor(totalPaid / weekPayment);

//         if (paidWeeks < totalExpectedWeeks) {
//           for (let w = paidWeeks; w < totalExpectedWeeks; w++) {
//             const weekNumber = w + 1;
//             const weekInterest = interestPerWeek;
//             const weekCapital = capitalPerWeek;
//             const weekTotal = weekInterest + weekCapital;

//             // Check if this week is partially paid
//             let isPartial = false;
//             let partialAmount = 0;
//             if (
//               w === paidWeeks &&
//               remainingPayment > 0 &&
//               remainingPayment < weekPayment
//             ) {
//               isPartial = true;
//               partialAmount = remainingPayment;
//             }

//             debtBreakdown.push({
//               week: weekNumber,
//               interest: weekInterest,
//               capital: weekCapital,
//               total: weekTotal,
//               paid: isPartial ? partialAmount : 0,
//               status: isPartial ? "partial" : "unpaid",
//             });
//           }
//         }

//         // Determine status
//         let status = "paid";
//         if (totalPaid < expectedTotal) {
//           status = totalPaid > 0 ? "partial" : "unpaid";
//         }

//         processedData.push({
//           loan_code: loanCode,
//           customer_name: record.ex_name || "Unknown",
//           branch: record.branch_name || record.bcode || "Unknown",
//           bcode: record.bcode,
//           ccode: record.ccode,
//           week_payment: weekPayment,
//           loan_amount: parseFloat(record.loan_amount) || 0,
//           loan_period: parseInt(record.loan_period) || 0,
//           loan_date: loanDate,
//           weeks_in_month: weeksInMonth,

//           // Expected
//           expected: {
//             interest: expectedInterest,
//             capital: expectedCapital,
//             total: expectedTotal,
//             weeks: weeksInMonth,
//           },

//           // Paid
//           paid: {
//             interest: paidInterest,
//             capital: paidCapital,
//             total: totalPaid,
//             weeks: weeksPaid,
//             count: paymentCount,
//           },

//           // Debt
//           debt: {
//             interest: debtInterest,
//             capital: debtCapital,
//             total: debtInterest + debtCapital,
//             breakdown: debtBreakdown,
//           },

//           // Next month (overpayment)
//           next_month:
//             nextMonthAmount > 0
//               ? {
//                   interest: nextMonthInterest,
//                   capital: nextMonthCapital,
//                   total: nextMonthAmount,
//                 }
//               : null,

//           is_overpaid: isOverpaid,
//           status: status,
//         });
//       } catch (err) {
//         logger.error(
//           `[InterestIncome] Error processing loan ${record.loan_code}:`,
//           err.message,
//         );
//         logger.error(`[InterestIncome] Record data:`, JSON.stringify(record));
//         // Continue processing other loans
//         continue;
//       }
//     }

//     logger.info(
//       `[InterestIncome] Successfully processed ${processedData.length} out of ${interestRecords.length} records`,
//     );

//     if (processedData.length === 0) {
//       logger.warn("[InterestIncome] No data processed successfully");
//       return {
//         month,
//         type: type || "company",
//         data: [],
//         summary: {
//           total_interest_expected: 0,
//           total_capital_expected: 0,
//           total_expected: 0,
//           total_interest_paid: 0,
//           total_capital_paid: 0,
//           total_paid: 0,
//           total_interest_debt: 0,
//           total_capital_debt: 0,
//           total_debt: 0,
//           customer_count: 0,
//         },
//       };
//     }

//     // ── Summarize by type ──
//     const summary = {
//       total_interest_expected: 0,
//       total_capital_expected: 0,
//       total_expected: 0,
//       total_interest_paid: 0,
//       total_capital_paid: 0,
//       total_paid: 0,
//       total_interest_debt: 0,
//       total_capital_debt: 0,
//       total_debt: 0,
//       customer_count: processedData.length,
//       overpaid_count: 0,
//       partial_count: 0,
//       unpaid_count: 0,
//     };

//     processedData.forEach((item) => {
//       summary.total_interest_expected += item.expected.interest;
//       summary.total_capital_expected += item.expected.capital;
//       summary.total_expected += item.expected.total;
//       summary.total_interest_paid += item.paid.interest;
//       summary.total_capital_paid += item.paid.capital;
//       summary.total_paid += item.paid.total;
//       summary.total_interest_debt += item.debt.interest;
//       summary.total_capital_debt += item.debt.capital;
//       summary.total_debt += item.debt.total;

//       if (item.is_overpaid) summary.overpaid_count++;
//       if (item.status === "partial") summary.partial_count++;
//       if (item.status === "unpaid") summary.unpaid_count++;
//     });

//     logger.info(
//       `[InterestIncome] Summary: total_expected=${summary.total_expected}, total_paid=${summary.total_paid}, total_debt=${summary.total_debt}`,
//     );

//     // ── Group by type (executive, branch, zone, company) ──
//     let data = processedData;

//     if (type === "executive") {
//       logger.info("[InterestIncome] Grouping by executive");
//       // Group by executive
//       const grouped = {};
//       processedData.forEach((item) => {
//         const key = item.customer_name;
//         if (!grouped[key]) {
//           grouped[key] = {
//             executive_name: key,
//             customer_count: 0,
//             expected: { interest: 0, capital: 0, total: 0 },
//             paid: { interest: 0, capital: 0, total: 0 },
//             debt: { interest: 0, capital: 0, total: 0 },
//             next_month: { interest: 0, capital: 0, total: 0 },
//             customers: [],
//           };
//         }
//         grouped[key].customer_count++;
//         grouped[key].expected.interest += item.expected.interest;
//         grouped[key].expected.capital += item.expected.capital;
//         grouped[key].expected.total += item.expected.total;
//         grouped[key].paid.interest += item.paid.interest;
//         grouped[key].paid.capital += item.paid.capital;
//         grouped[key].paid.total += item.paid.total;
//         grouped[key].debt.interest += item.debt.interest;
//         grouped[key].debt.capital += item.debt.capital;
//         grouped[key].debt.total += item.debt.total;
//         if (item.next_month) {
//           grouped[key].next_month.interest += item.next_month.interest;
//           grouped[key].next_month.capital += item.next_month.capital;
//           grouped[key].next_month.total += item.next_month.total;
//         }
//         grouped[key].customers.push(item);
//       });

//       return {
//         month,
//         type: "executive",
//         data: Object.values(grouped),
//         summary,
//         total: summary.total_expected,
//       };
//     }

//     if (type === "branch") {
//       logger.info("[InterestIncome] Grouping by branch");
//       // Group by branch
//       const grouped = {};
//       processedData.forEach((item) => {
//         const key = item.branch;
//         if (!grouped[key]) {
//           grouped[key] = {
//             branch_name: key,
//             customer_count: 0,
//             expected: { interest: 0, capital: 0, total: 0 },
//             paid: { interest: 0, capital: 0, total: 0 },
//             debt: { interest: 0, capital: 0, total: 0 },
//             next_month: { interest: 0, capital: 0, total: 0 },
//           };
//         }
//         grouped[key].customer_count++;
//         grouped[key].expected.interest += item.expected.interest;
//         grouped[key].expected.capital += item.expected.capital;
//         grouped[key].expected.total += item.expected.total;
//         grouped[key].paid.interest += item.paid.interest;
//         grouped[key].paid.capital += item.paid.capital;
//         grouped[key].paid.total += item.paid.total;
//         grouped[key].debt.interest += item.debt.interest;
//         grouped[key].debt.capital += item.debt.capital;
//         grouped[key].debt.total += item.debt.total;
//         if (item.next_month) {
//           grouped[key].next_month.interest += item.next_month.interest;
//           grouped[key].next_month.capital += item.next_month.capital;
//           grouped[key].next_month.total += item.next_month.total;
//         }
//       });

//       return {
//         month,
//         type: "branch",
//         data: Object.values(grouped),
//         summary,
//         total: summary.total_expected,
//       };
//     }

//     if (type === "zone") {
//       logger.info("[InterestIncome] Grouping by zone");
//       // Get zone mapping
//       const zoneBranches = await adminDb.query(
//         `SELECT bcode, bname, zone FROM zone_branches`,
//       );

//       const zoneMap = {};
//       zoneBranches.forEach((item) => {
//         zoneMap[item.bname] = item.zone;
//       });

//       const grouped = {};
//       processedData.forEach((item) => {
//         const zone = zoneMap[item.branch] || "OTHER";
//         const key = zone;
//         if (!grouped[key]) {
//           grouped[key] = {
//             zone_name: `Zone ${zone}`,
//             customer_count: 0,
//             expected: { interest: 0, capital: 0, total: 0 },
//             paid: { interest: 0, capital: 0, total: 0 },
//             debt: { interest: 0, capital: 0, total: 0 },
//             next_month: { interest: 0, capital: 0, total: 0 },
//           };
//         }
//         grouped[key].customer_count++;
//         grouped[key].expected.interest += item.expected.interest;
//         grouped[key].expected.capital += item.expected.capital;
//         grouped[key].expected.total += item.expected.total;
//         grouped[key].paid.interest += item.paid.interest;
//         grouped[key].paid.capital += item.paid.capital;
//         grouped[key].paid.total += item.paid.total;
//         grouped[key].debt.interest += item.debt.interest;
//         grouped[key].debt.capital += item.debt.capital;
//         grouped[key].debt.total += item.debt.total;
//         if (item.next_month) {
//           grouped[key].next_month.interest += item.next_month.interest;
//           grouped[key].next_month.capital += item.next_month.capital;
//           grouped[key].next_month.total += item.next_month.total;
//         }
//       });

//       return {
//         month,
//         type: "zone",
//         data: Object.values(grouped),
//         summary,
//         total: summary.total_expected,
//       };
//     }

//     // ── Company-wise (Default) ──
//     logger.info("[InterestIncome] Returning company-wise data");
//     return {
//       month,
//       type: "company",
//       data: processedData,
//       summary,
//       total: summary.total_expected,
//     };
//   } catch (error) {
//     logger.error("[InterestIncome] Error fetching interest income:", error);
//     logger.error("[InterestIncome] Error stack:", error.stack);
//     throw error;
//   }
// }

async function calculateAndStoreInterestIncome(year, month) {
  const incomeMonth = `${year}-${String(month).padStart(2, "0")}`;
  const startDate = `${incomeMonth}-01`;
  // last day of month, safely handles Feb/28/29/30/31
  const endDateObj = new Date(year, month, 0); // day 0 of next month = last day of this month
  const endDate = endDateObj.toISOString().slice(0, 10);

  logger.info(
    `[interestIncome] Running for ${incomeMonth} (${startDate} to ${endDate})`,
  );

  // ── 1. Fetch all loans issued in that month ─────────────────────────
  const loans = await mainDb.query(
    `SELECT
       loan_code,
       loan_amount,
       interest,          -- adjust column name if different (e.g. interest_rate)
       period,            -- column name is 'period' in customer table
       week_payment,
       bcode,
       ccode,
       center,
       loan_date,
       due_date    
     FROM customer
     WHERE loan_date BETWEEN ? AND ?`,
    [startDate, endDate],
  );

  logger.info(
    `[interestIncome] Found ${loans.length} loans for ${incomeMonth}`,
  );

  let inserted = 0;
  let skipped = 0;

  for (const loan of loans) {
    try {
      const loanAmount = parseFloat(loan.loan_amount) || 0;
      if (loanAmount <= 0) {
        skipped++;
        continue;
      }

      // interest stored as a fraction already (e.g. 0.30)? if it's stored
      // as a whole percent (e.g. 30), divide by 100 instead — adjust as needed
      const interestRate =
        loan.interest != null && !isNaN(loan.interest)
          ? parseFloat(loan.interest)
          : DEFAULT_INTEREST_RATE;

      // Use 'period' from the query result (column name in customer table)
      const loanPeriod =
        loan.period != null && Number(loan.period) > 0
          ? parseInt(loan.period)
          : DEFAULT_LOAN_PERIOD;

      const fullLoanAmount = loanAmount * (1 + interestRate);
      const weekPayment =
        parseFloat(loan.week_payment) || fullLoanAmount / loanPeriod;

      // ── Split into capital vs interest, per week ──
      const capitalPerWeek = loanAmount / loanPeriod;
      const interestPerWeek = (fullLoanAmount - loanAmount) / loanPeriod;

      // ── 2. Resolve executive name from branch table (center + ccode) ──
      const branchRows = await mainDb.query(
        `SELECT name FROM branch
         WHERE bcode = ? AND center = ? AND ccode = ?
         LIMIT 1`,
        [loan.bcode, (loan.center || "").trim(), (loan.ccode || "").trim()],
      );
      const exName = branchRows.length > 0 ? branchRows[0].name : null;

      // ── 3. Insert into admin DB (idempotent via unique key) ──
      await adminDb.query(
        `INSERT INTO loan_interest_income
     (bcode, ccode, loan_code, ex_name, loan_amount, loan_period,
      interest_rate, week_payment, full_loan_amount, capital, interest,
      loan_date, due_date, income_month)   -- ✅ Added due_date here
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)   -- ✅ Added one more ? placeholder
   ON DUPLICATE KEY UPDATE
     ex_name = VALUES(ex_name),
     loan_amount = VALUES(loan_amount),
     loan_period = VALUES(loan_period),
     interest_rate = VALUES(interest_rate),
     week_payment = VALUES(week_payment),
     full_loan_amount = VALUES(full_loan_amount),
     capital = VALUES(capital),
     interest = VALUES(interest),
     due_date = VALUES(due_date)   -- ✅ Added this line for updates
   `,
        [
          loan.bcode,
          loan.ccode,
          loan.loan_code,
          exName,
          loanAmount,
          loanPeriod,
          interestRate,
          weekPayment,
          fullLoanAmount,
          capitalPerWeek,
          interestPerWeek,
          loan.loan_date,
          loan.due_date, // ✅ Added this line
          incomeMonth,
        ],
      );

      inserted++;
    } catch (err) {
      logger.error(
        `[interestIncome] Failed for loan_code=${loan.loan_code}:`,
        err.message,
      );
      // continue processing remaining loans — one bad row shouldn't kill the batch
    }
  }

  logger.info(
    `[interestIncome] Done for ${incomeMonth}: inserted/updated=${inserted}, skipped=${skipped}`,
  );

  return { incomeMonth, total: loans.length, inserted, skipped };
}

async function getInterestIncome(month, type) {
  logger.info(
    `[InterestIncome] Starting with month=${month}, type=${type || "company"}`,
  );

  if (!month) {
    logger.error("[InterestIncome] Month parameter is missing");
    const error = new Error("month query parameter is required");
    error.statusCode = 400;
    throw error;
  }

  try {
    // ── 1. Get all currently ACTIVE customers (not lapsed, still owing) ──
    logger.info("[InterestIncome] Fetching active customers");
    const activeCustomers = await mainDb.query(
      `SELECT loan_code, cname, name AS ex_name, bname, bcode, ccode, loan_balance, due_date
       FROM customer
       WHERE loan_balance != 0 AND due_date >= CURDATE()`,
    );

    logger.info(
      `[InterestIncome] Found ${activeCustomers?.length || 0} active customers`,
    );

    if (!activeCustomers || activeCustomers.length === 0) {
      logger.warn("[InterestIncome] No active customers found");
      return {
        month,
        type: type || "company",
        data: [],
        summary: {
          total_interest_expected: 0,
          total_capital_expected: 0,
          total_expected: 0,
          total_interest_paid: 0,
          total_capital_paid: 0,
          total_paid: 0,
          total_interest_debt: 0,
          total_capital_debt: 0,
          total_debt: 0,
          customer_count: 0,
        },
      };
    }

    // ── 2. Get loan_interest_income rates for all active loan_codes ──
    // (interest/capital-per-week are fixed at loan issuance, so no need to
    // filter by income_month — just match by loan_code)
    const loanCodes = activeCustomers.map((c) => c.loan_code);
    const loanCodePlaceholders = loanCodes.map(() => "?").join(",");

    const interestIncomeRows = await adminDb.query(
      `SELECT li.*, b.bname AS branch_name 
       FROM loan_interest_income li
       LEFT JOIN zone_branches b ON li.bcode = b.bcode
       WHERE li.loan_code IN (${loanCodePlaceholders})`,
      loanCodes,
    );
    const interestMap = {};
    interestIncomeRows.forEach((r) => {
      interestMap[r.loan_code] = r;
    });

    // ── 3. Month boundaries for filtering customer_dues.created_at ──
    const monthStartStr = `${month}-01 00:00:00`;
    const monthEndDateObj = new Date(month + "-01");
    monthEndDateObj.setMonth(monthEndDateObj.getMonth() + 1);
    monthEndDateObj.setDate(0);
    const monthEndStr = `${monthEndDateObj.toISOString().slice(0, 10)} 23:59:59`;

    logger.info(
      `[InterestIncome] Processing ${activeCustomers.length} active loans for ${monthStartStr} → ${monthEndStr}`,
    );

    const processedData = [];

    for (const customer of activeCustomers) {
      try {
        const loanCode = customer.loan_code;
        const incomeRecord = interestMap[loanCode];

        if (!incomeRecord) {
          logger.warn(
            `[InterestIncome] No loan_interest_income row for loan_code=${loanCode} — skipping`,
          );
          continue;
        }

        const weekPayment = parseFloat(incomeRecord.week_payment) || 0;
        const interestPerWeek = parseFloat(incomeRecord.interest) || 0;
        const capitalPerWeek = parseFloat(incomeRecord.capital) || 0;
        const loanDate = incomeRecord.loan_date;

        // ── Get this loan's customer_dues rows created within the month ──
        const duesResult = await mainDb.query(
          `SELECT COALESCE(SUM(expected_payment), 0) AS total_expected,
                  COUNT(*) AS due_count
           FROM customer_dues
           WHERE loan_code = ?
             AND created_at BETWEEN ? AND ?`,
          [loanCode, monthStartStr, monthEndStr],
        );
        const dueCount = parseInt(duesResult[0]?.due_count) || 0;
        const totalExpectedFromDues =
          parseFloat(duesResult[0]?.total_expected) || 0;

        logger.debug(
          `[InterestIncome] Loan ${loanCode}: dueCount=${dueCount}, totalExpectedFromDues=${totalExpectedFromDues}`,
        );

        if (dueCount === 0) {
          // No dues recorded for this loan in this month — skip
          continue;
        }

        // ── Expected = interest/capital-per-week × dueCount for this month ──
        const expectedInterest = interestPerWeek * dueCount;
        const expectedCapital = capitalPerWeek * dueCount;
        const expectedTotal = expectedInterest + expectedCapital;

        logger.debug(
          `[InterestIncome] Loan ${loanCode}: expectedInterest=${expectedInterest}, expectedCapital=${expectedCapital}, expectedTotal=${expectedTotal}`,
        );

        // ── Get all payments for this loan up to month end ──
        const monthEndDateStr = monthEndDateObj.toISOString().slice(0, 10);
        const payments = await mainDb.query(
          `SELECT 
    SUM(payment) AS total_paid,
    COUNT(*) AS payment_count
  FROM payments
  WHERE loan_code = ?
    AND payment_date BETWEEN ? AND ?`,
          [loanCode, monthStartStr, monthEndStr],
        );

        const totalPaid = parseFloat(payments[0]?.total_paid) || 0;
        const paymentCount = parseInt(payments[0]?.payment_count) || 0;

        logger.debug(
          `[InterestIncome] Loan ${loanCode}: totalPaid=${totalPaid}, paymentCount=${paymentCount}`,
        );

        // ── Calculate actual payments (same weeks-paid logic as before) ──
        const weeksPaid =
          weekPayment > 0 ? Math.floor(totalPaid / weekPayment) : 0;
        const remainingPayment = weekPayment > 0 ? totalPaid % weekPayment : 0;

        let paidInterest = 0;
        let paidCapital = 0;
        let debtInterest = 0;
        let debtCapital = 0;
        let nextMonthInterest = 0;
        let nextMonthCapital = 0;
        let nextMonthAmount = 0;
        let isOverpaid = false;

        if (weeksPaid > 0) {
          paidInterest = interestPerWeek * weeksPaid;
          paidCapital = capitalPerWeek * weeksPaid;
        }

        if (remainingPayment > 0) {
          if (remainingPayment >= weekPayment) {
            const extraPayment = remainingPayment - weekPayment;
            const extraWeeks = Math.floor(extraPayment / weekPayment);
            const extraRemainder = extraPayment % weekPayment;

            paidInterest += interestPerWeek;
            paidCapital += capitalPerWeek;

            if (extraWeeks > 0) {
              nextMonthInterest = interestPerWeek * extraWeeks;
              nextMonthCapital = capitalPerWeek * extraWeeks;
              nextMonthAmount = nextMonthInterest + nextMonthCapital;
            }

            if (extraRemainder > 0) {
              const ratio = extraRemainder / weekPayment;
              nextMonthInterest += interestPerWeek * ratio;
              nextMonthCapital += capitalPerWeek * ratio;
              nextMonthAmount += extraRemainder;
            }

            isOverpaid = true;
          } else {
            const ratio = remainingPayment / weekPayment;
            paidInterest += interestPerWeek * ratio;
            paidCapital += capitalPerWeek * ratio;
          }
        }

        // Cap paid amounts at expected — this month's paid figures shouldn't
        // exceed what was expected for this month specifically
        if (paidInterest > expectedInterest) paidInterest = expectedInterest;
        if (paidCapital > expectedCapital) paidCapital = expectedCapital;
        const monthPaidTotal = paidInterest + paidCapital;

        if (monthPaidTotal < expectedTotal) {
          const debtAmount = expectedTotal - monthPaidTotal;
          const debtRatio = expectedTotal > 0 ? debtAmount / expectedTotal : 0;
          debtInterest = expectedInterest * debtRatio;
          debtCapital = expectedCapital * debtRatio;
        }

        let status = "paid";
        if (monthPaidTotal < expectedTotal) {
          status = monthPaidTotal > 0 ? "partial" : "unpaid";
        }

        processedData.push({
          loan_code: loanCode,
          customer_name: customer.ex_name || incomeRecord.ex_name || "Unknown",
          branch:
            incomeRecord.branch_name ||
            customer.bname ||
            incomeRecord.bcode ||
            "Unknown",
          bcode: incomeRecord.bcode,
          ccode: incomeRecord.ccode,
          week_payment: weekPayment,
          loan_amount: parseFloat(incomeRecord.loan_amount) || 0,
          loan_period: parseInt(incomeRecord.loan_period) || 0,
          loan_date: loanDate,
          due_count: dueCount,

          expected: {
            interest: expectedInterest,
            capital: expectedCapital,
            total: expectedTotal,
            due_count: dueCount,
          },

          paid: {
            interest: paidInterest,
            capital: paidCapital,
            total: monthPaidTotal,
            weeks: weeksPaid,
            count: paymentCount,
          },

          debt: {
            interest: debtInterest,
            capital: debtCapital,
            total: debtInterest + debtCapital,
          },

          next_month:
            nextMonthAmount > 0
              ? {
                  interest: nextMonthInterest,
                  capital: nextMonthCapital,
                  total: nextMonthAmount,
                }
              : null,

          is_overpaid: isOverpaid,
          status: status,
        });
      } catch (err) {
        logger.error(
          `[InterestIncome] Error processing loan ${customer.loan_code}:`,
          err.message,
        );
        continue;
      }
    }

    logger.info(
      `[InterestIncome] Successfully processed ${processedData.length} out of ${activeCustomers.length} active customers`,
    );

    if (processedData.length === 0) {
      return {
        month,
        type: type || "company",
        data: [],
        summary: {
          total_interest_expected: 0,
          total_capital_expected: 0,
          total_expected: 0,
          total_interest_paid: 0,
          total_capital_paid: 0,
          total_paid: 0,
          total_interest_debt: 0,
          total_capital_debt: 0,
          total_debt: 0,
          customer_count: 0,
        },
      };
    }

    // ── Summarize (unchanged) ──
    const summary = {
      total_interest_expected: 0,
      total_capital_expected: 0,
      total_expected: 0,
      total_interest_paid: 0,
      total_capital_paid: 0,
      total_paid: 0,
      total_interest_debt: 0,
      total_capital_debt: 0,
      total_debt: 0,
      customer_count: processedData.length,
      overpaid_count: 0,
      partial_count: 0,
      unpaid_count: 0,
    };

    processedData.forEach((item) => {
      summary.total_interest_expected += item.expected.interest;
      summary.total_capital_expected += item.expected.capital;
      summary.total_expected += item.expected.total;
      summary.total_interest_paid += item.paid.interest;
      summary.total_capital_paid += item.paid.capital;
      summary.total_paid += item.paid.total;
      summary.total_interest_debt += item.debt.interest;
      summary.total_capital_debt += item.debt.capital;
      summary.total_debt += item.debt.total;

      if (item.is_overpaid) summary.overpaid_count++;
      if (item.status === "partial") summary.partial_count++;
      if (item.status === "unpaid") summary.unpaid_count++;
    });

    logger.info(
      `[InterestIncome] Summary: total_expected=${summary.total_expected}, total_paid=${summary.total_paid}, total_debt=${summary.total_debt}`,
    );

    // ── Group by type (executive, branch, zone, company) — unchanged ──
    if (type === "executive") {
      const grouped = {};
      processedData.forEach((item) => {
        const key = item.customer_name;
        if (!grouped[key]) {
          grouped[key] = {
            executive_name: key,
            customer_count: 0,
            expected: { interest: 0, capital: 0, total: 0 },
            paid: { interest: 0, capital: 0, total: 0 },
            debt: { interest: 0, capital: 0, total: 0 },
            next_month: { interest: 0, capital: 0, total: 0 },
            customers: [],
          };
        }
        grouped[key].customer_count++;
        grouped[key].expected.interest += item.expected.interest;
        grouped[key].expected.capital += item.expected.capital;
        grouped[key].expected.total += item.expected.total;
        grouped[key].paid.interest += item.paid.interest;
        grouped[key].paid.capital += item.paid.capital;
        grouped[key].paid.total += item.paid.total;
        grouped[key].debt.interest += item.debt.interest;
        grouped[key].debt.capital += item.debt.capital;
        grouped[key].debt.total += item.debt.total;
        if (item.next_month) {
          grouped[key].next_month.interest += item.next_month.interest;
          grouped[key].next_month.capital += item.next_month.capital;
          grouped[key].next_month.total += item.next_month.total;
        }
        grouped[key].customers.push(item);
      });

      return {
        month,
        type: "executive",
        data: Object.values(grouped),
        summary,
        total: summary.total_expected,
      };
    }

    if (type === "branch") {
      const grouped = {};
      processedData.forEach((item) => {
        const key = item.branch;
        if (!grouped[key]) {
          grouped[key] = {
            branch_name: key,
            customer_count: 0,
            expected: { interest: 0, capital: 0, total: 0 },
            paid: { interest: 0, capital: 0, total: 0 },
            debt: { interest: 0, capital: 0, total: 0 },
            next_month: { interest: 0, capital: 0, total: 0 },
          };
        }
        grouped[key].customer_count++;
        grouped[key].expected.interest += item.expected.interest;
        grouped[key].expected.capital += item.expected.capital;
        grouped[key].expected.total += item.expected.total;
        grouped[key].paid.interest += item.paid.interest;
        grouped[key].paid.capital += item.paid.capital;
        grouped[key].paid.total += item.paid.total;
        grouped[key].debt.interest += item.debt.interest;
        grouped[key].debt.capital += item.debt.capital;
        grouped[key].debt.total += item.debt.total;
        if (item.next_month) {
          grouped[key].next_month.interest += item.next_month.interest;
          grouped[key].next_month.capital += item.next_month.capital;
          grouped[key].next_month.total += item.next_month.total;
        }
      });

      return {
        month,
        type: "branch",
        data: Object.values(grouped),
        summary,
        total: summary.total_expected,
      };
    }

    if (type === "zone") {
      const zoneBranches = await adminDb.query(
        `SELECT bcode, bname, zone FROM zone_branches`,
      );
      const zoneMap = {};
      zoneBranches.forEach((item) => {
        zoneMap[item.bname] = item.zone;
      });

      const grouped = {};
      processedData.forEach((item) => {
        const zone = zoneMap[item.branch] || "OTHER";
        const key = zone;
        if (!grouped[key]) {
          grouped[key] = {
            zone_name: `Zone ${zone}`,
            customer_count: 0,
            expected: { interest: 0, capital: 0, total: 0 },
            paid: { interest: 0, capital: 0, total: 0 },
            debt: { interest: 0, capital: 0, total: 0 },
            next_month: { interest: 0, capital: 0, total: 0 },
          };
        }
        grouped[key].customer_count++;
        grouped[key].expected.interest += item.expected.interest;
        grouped[key].expected.capital += item.expected.capital;
        grouped[key].expected.total += item.expected.total;
        grouped[key].paid.interest += item.paid.interest;
        grouped[key].paid.capital += item.paid.capital;
        grouped[key].paid.total += item.paid.total;
        grouped[key].debt.interest += item.debt.interest;
        grouped[key].debt.capital += item.debt.capital;
        grouped[key].debt.total += item.debt.total;
        if (item.next_month) {
          grouped[key].next_month.interest += item.next_month.interest;
          grouped[key].next_month.capital += item.next_month.capital;
          grouped[key].next_month.total += item.next_month.total;
        }
      });

      return {
        month,
        type: "zone",
        data: Object.values(grouped),
        summary,
        total: summary.total_expected,
      };
    }

    return {
      month,
      type: "company",
      data: processedData,
      summary,
      total: summary.total_expected,
    };
  } catch (error) {
    logger.error("[InterestIncome] Error fetching interest income:", error);
    logger.error("[InterestIncome] Error stack:", error.stack);
    throw error;
  }
}
module.exports = {
  getOtherIncome,
  calculateAndStoreInterestIncome,
  getInterestIncome,
};
