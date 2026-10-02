const cron = require("node-cron");
const {
  calculateAndStoreInterestIncome,
} = require("../services/income.service");
const logger = require("../utils/logger");

/**
 * Runs on the 1st of every month at 01:00, processing the PREVIOUS month
 * (since that month's loans are now fully known/closed).
 * Cron format: minute hour day month weekday
 */
// function startInterestIncomeScheduler() {
//   cron.schedule("38 10 * * *", async () => {
//     const now = new Date();
//     // previous month
//     const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
//     const year = prevMonthDate.getFullYear();
//     const month = prevMonthDate.getMonth() + 1;

//     logger.info(
//       `[scheduler] Triggering interest income job for ${year}-${month}`,
//     );
//     try {
//       const result = await calculateAndStoreInterestIncome(year, month);
//       logger.info("[scheduler] Interest income job completed:", result);
//     } catch (err) {
//       logger.error("[scheduler] Interest income job failed:", err);
//     }
//   });

//   logger.info("Interest income scheduler registered (runs , 10:00).");
// }

// Change this value as needed
const INTEREST_INCOME_CONFIG = {
  // Set to null for current month, or specify:
  overrideMonth: "2026-08", // Currently set to July 2026
  // overrideMonth: "2026-05", // Change to May 2026 when needed
  // overrideMonth: null,      // Set to null to use current month
};

function startInterestIncomeScheduler() {
  cron.schedule("3 10 * * *", async () => {
    const now = new Date();
    let year, month;

    if (INTEREST_INCOME_CONFIG.overrideMonth) {
      const [overrideYear, overrideMonthNum] =
        INTEREST_INCOME_CONFIG.overrideMonth.split("-").map(Number);
      year = overrideYear;
      month = overrideMonthNum;
      logger.info(
        `[scheduler] Using configured month: ${year}-${String(month).padStart(2, "0")}`,
      );
    } else {
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }

    logger.info(
      `[scheduler] Triggering interest income job for ${year}-${String(month).padStart(2, "0")}`,
    );
    try {
      const result = await calculateAndStoreInterestIncome(year, month);
      logger.info("[scheduler] Interest income job completed:", result);
    } catch (err) {
      logger.error("[scheduler] Interest income job failed:", err);
    }
  });

  logger.info("Interest income scheduler registered (runs at 10:48 AM daily).");
}

module.exports = { startInterestIncomeScheduler };
