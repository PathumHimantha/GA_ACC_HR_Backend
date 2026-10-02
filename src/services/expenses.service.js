const mainDb = require("../db/mainDb");
const adminDb = require("../db/adminDb");
const logger = require("../utils/logger");

async function getBranchExpenses(month, type, branch) {
  if (!month) {
    const error = new Error("month query parameter is required");
    error.statusCode = 400;
    throw error;
  }

  try {
    // ── Branch-wise expenses ──
    if (type === "branch") {
      let query = `
        SELECT
          branch,
          COALESCE(SUM(amount), 0) AS total_expenses,
          COUNT(*) AS transaction_count,
          GROUP_CONCAT(DISTINCT category) AS categories
        FROM branch_expenses
        WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
      `;
      const params = [month];

      // Add branch filter if provided
      if (branch && branch !== "all") {
        query += ` AND branch = ?`;
        params.push(branch);
      }

      query += ` GROUP BY branch ORDER BY branch`;

      const rows = await mainDb.query(query, params);

      // Get category breakdown for each branch
      const branchData = await Promise.all(
        rows.map(async (row) => {
          const categoryQuery = `
            SELECT
              category,
              COALESCE(SUM(amount), 0) AS amount
            FROM branch_expenses
            WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
              AND branch = ?
            GROUP BY category
            ORDER BY amount DESC
          `;
          const categoryParams = [month, row.branch];
          const categories = await mainDb.query(categoryQuery, categoryParams);

          return {
            branch_name: row.branch,
            total_expenses: Number(row.total_expenses || 0),
            transaction_count: Number(row.transaction_count || 0),
            categories: categories.map((cat) => ({
              category: cat.category,
              amount: Number(cat.amount || 0),
            })),
          };
        }),
      );

      return {
        month,
        type: "branch",
        data: branchData,
        total: branchData.reduce((sum, b) => sum + b.total_expenses, 0),
      };
    }

    // ── Zone-wise expenses ──
    if (type === "zone") {
      // Get zone mapping from admin DB with both bcode and bname
      const zoneBranches = await adminDb.query(
        `SELECT bcode, bname, zone FROM zone_branches`,
      );

      // Create mapping by branch name (bname) to zone
      const zoneMapByName = {};
      const zoneMapByCode = {};

      zoneBranches.forEach((item) => {
        // Map by branch name
        if (item.bname) {
          zoneMapByName[item.bname] = item.zone;
        }
        // Map by branch code
        if (item.bcode) {
          zoneMapByCode[item.bcode] = item.zone;
        }
      });

      // Get all branch expenses
      let query = `
        SELECT
          branch,
          COALESCE(SUM(amount), 0) AS total_expenses,
          COUNT(*) AS transaction_count
        FROM branch_expenses
        WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
      `;
      const params = [month];

      if (branch && branch !== "all") {
        query += ` AND branch = ?`;
        params.push(branch);
      }

      query += ` GROUP BY branch`;

      const rows = await mainDb.query(query, params);

      // Group by zone
      const zones = {};

      rows.forEach((row) => {
        // Try to find zone by branch name first, then by branch code
        let zone =
          zoneMapByName[row.branch] || zoneMapByCode[row.branch] || "OTHER";

        // Clean up zone name
        let zoneName = `Zone ${zone}`;
        if (zone === "A") zoneName = "Zone A";
        else if (zone === "B") zoneName = "Zone B";
        else if (zone === "C") zoneName = "Zone C";
        else if (zone === "OTHER") zoneName = "Other";

        if (!zones[zone]) {
          zones[zone] = {
            zone_name: zoneName,
            total_expenses: 0,
            transaction_count: 0,
            branches: [],
          };
        }

        zones[zone].total_expenses += Number(row.total_expenses || 0);
        zones[zone].transaction_count += Number(row.transaction_count || 0);
        zones[zone].branches.push({
          name: row.branch,
          total_expenses: Number(row.total_expenses || 0),
          transaction_count: Number(row.transaction_count || 0),
        });
      });

      // Sort zones by total expenses (descending)
      const sortedZones = Object.values(zones).sort(
        (a, b) => b.total_expenses - a.total_expenses,
      );

      return {
        month,
        type: "zone",
        data: sortedZones,
        total: sortedZones.reduce((sum, z) => sum + z.total_expenses, 0),
      };
    }

    // ── Company-wise (Default) ──
    let query = `
      SELECT
        COALESCE(SUM(amount), 0) AS total_expenses,
        COUNT(*) AS transaction_count,
        COUNT(DISTINCT branch) AS branch_count,
        COUNT(DISTINCT category) AS category_count
      FROM branch_expenses
      WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
    `;
    const params = [month];

    if (branch && branch !== "all") {
      query += ` AND branch = ?`;
      params.push(branch);
    }

    const rows = await mainDb.query(query, params);

    // Get top categories company-wide
    const categoryQuery = `
      SELECT
        category,
        COALESCE(SUM(amount), 0) AS amount,
        COUNT(*) AS count
      FROM branch_expenses
      WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
      ${branch && branch !== "all" ? " AND branch = ?" : ""}
      GROUP BY category
      ORDER BY amount DESC
      LIMIT 10
    `;
    const categoryParams = [month];
    if (branch && branch !== "all") {
      categoryParams.push(branch);
    }
    const topCategories = await mainDb.query(categoryQuery, categoryParams);

    // Get top branches company-wide
    const branchQuery = `
      SELECT
        branch,
        COALESCE(SUM(amount), 0) AS total_expenses,
        COUNT(*) AS transaction_count
      FROM branch_expenses
      WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
      ${branch && branch !== "all" ? " AND branch = ?" : ""}
      GROUP BY branch
      ORDER BY total_expenses DESC
      LIMIT 10
    `;
    const branchParams = [month];
    if (branch && branch !== "all") {
      branchParams.push(branch);
    }
    const topBranches = await mainDb.query(branchQuery, branchParams);

    // Get monthly trend (daily)
    const trendQuery = `
      SELECT
        DATE(expense_date) AS date,
        COALESCE(SUM(amount), 0) AS daily_total,
        COUNT(*) AS daily_count
      FROM branch_expenses
      WHERE DATE_FORMAT(expense_date, '%Y-%m') = ?
      ${branch && branch !== "all" ? " AND branch = ?" : ""}
      GROUP BY DATE(expense_date)
      ORDER BY date
    `;
    const trendParams = [month];
    if (branch && branch !== "all") {
      trendParams.push(branch);
    }
    const trendData = await mainDb.query(trendQuery, trendParams);

    const row = rows[0] || {};

    // Get all branches for filter
    const branches = await mainDb.query(
      `SELECT DISTINCT branch FROM branch_expenses WHERE DATE_FORMAT(expense_date, '%Y-%m') = ? ORDER BY branch`,
      [month],
    );

    return {
      month,
      type: "company",
      branch: branch || "all",
      summary: {
        total_expenses: Number(row.total_expenses || 0),
        transaction_count: Number(row.transaction_count || 0),
        branch_count: Number(row.branch_count || 0),
        category_count: Number(row.category_count || 0),
      },
      top_categories: topCategories.map((cat) => ({
        category: cat.category,
        amount: Number(cat.amount || 0),
        count: Number(cat.count || 0),
      })),
      top_branches: topBranches.map((b) => ({
        branch: b.branch,
        total_expenses: Number(b.total_expenses || 0),
        transaction_count: Number(b.transaction_count || 0),
      })),
      trend: trendData.map((t) => ({
        date: t.date,
        daily_total: Number(t.daily_total || 0),
        daily_count: Number(t.daily_count || 0),
      })),
      branches: branches.map((b) => b.branch),
      total: Number(row.total_expenses || 0),
    };
  } catch (error) {
    logger.error("[BranchExpenses] Error fetching branch expenses:", error);
    throw error;
  }
}

async function getDeathSettlements(month, type, branch) {
  if (!month) {
    const error = new Error("month query parameter is required");
    error.statusCode = 400;
    throw error;
  }

  try {
    // ── Branch-wise death settlements ──
    if (type === "branch") {
      let query = `
        SELECT
          bname AS branch,
          COALESCE(SUM(payment), 0) AS total_amount,
          COUNT(*) AS settlement_count,
          GROUP_CONCAT(DISTINCT name) AS customers
        FROM death_settle
        WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
          AND approval_status = 'approved'
      `;
      const params = [month];

      if (branch && branch !== "all") {
        query += ` AND bname = ?`;
        params.push(branch);
      }

      query += ` GROUP BY bname ORDER BY total_amount DESC`;

      const rows = await mainDb.query(query, params);

      // Get customer breakdown for each branch
      const branchData = await Promise.all(
        rows.map(async (row) => {
          const customerQuery = `
            SELECT
              name AS customer_name,
              COALESCE(SUM(payment), 0) AS amount,
              COUNT(*) AS count
            FROM death_settle
            WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
              AND bname = ?
              AND approval_status = 'approved'
            GROUP BY name
            ORDER BY amount DESC
          `;
          const customerParams = [month, row.branch];
          const customers = await mainDb.query(customerQuery, customerParams);

          return {
            branch_name: row.branch,
            total_amount: Number(row.total_amount || 0),
            settlement_count: Number(row.settlement_count || 0),
            customers: customers.map((cust) => ({
              name: cust.customer_name,
              amount: Number(cust.amount || 0),
              count: Number(cust.count || 0),
            })),
          };
        }),
      );

      return {
        month,
        type: "branch",
        data: branchData,
        total: branchData.reduce((sum, b) => sum + b.total_amount, 0),
      };
    }

    // ── Zone-wise death settlements ──
    if (type === "zone") {
      const zoneBranches = await adminDb.query(
        `SELECT bcode, bname, zone FROM zone_branches`,
      );

      const zoneMapByName = {};
      const zoneMapByCode = {};

      zoneBranches.forEach((item) => {
        if (item.bname) {
          zoneMapByName[item.bname] = item.zone;
        }
        if (item.bcode) {
          zoneMapByCode[item.bcode] = item.zone;
        }
      });

      let query = `
        SELECT
          bname AS branch,
          COALESCE(SUM(payment), 0) AS total_amount,
          COUNT(*) AS settlement_count
        FROM death_settle
        WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
          AND approval_status = 'approved'
      `;
      const params = [month];

      if (branch && branch !== "all") {
        query += ` AND bname = ?`;
        params.push(branch);
      }

      query += ` GROUP BY bname`;

      const rows = await mainDb.query(query, params);

      const zones = {};

      rows.forEach((row) => {
        let zone =
          zoneMapByName[row.branch] || zoneMapByCode[row.branch] || "OTHER";

        let zoneName = `Zone ${zone}`;
        if (zone === "A") zoneName = "Zone A";
        else if (zone === "B") zoneName = "Zone B";
        else if (zone === "C") zoneName = "Zone C";
        else if (zone === "OTHER") zoneName = "Other";

        if (!zones[zone]) {
          zones[zone] = {
            zone_name: zoneName,
            total_amount: 0,
            settlement_count: 0,
            branches: [],
          };
        }

        zones[zone].total_amount += Number(row.total_amount || 0);
        zones[zone].settlement_count += Number(row.settlement_count || 0);
        zones[zone].branches.push({
          name: row.branch,
          total_amount: Number(row.total_amount || 0),
          settlement_count: Number(row.settlement_count || 0),
        });
      });

      const sortedZones = Object.values(zones).sort(
        (a, b) => b.total_amount - a.total_amount,
      );

      return {
        month,
        type: "zone",
        data: sortedZones,
        total: sortedZones.reduce((sum, z) => sum + z.total_amount, 0),
      };
    }

    // ── Company-wise (Default) ──
    let query = `
      SELECT
        COALESCE(SUM(payment), 0) AS total_amount,
        COUNT(*) AS settlement_count,
        COUNT(DISTINCT bname) AS branch_count,
        COUNT(DISTINCT name) AS customer_count
      FROM death_settle
      WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
        AND approval_status = 'approved'
    `;
    const params = [month];

    if (branch && branch !== "all") {
      query += ` AND bname = ?`;
      params.push(branch);
    }

    const rows = await mainDb.query(query, params);

    // Get top customers
    const customerQuery = `
      SELECT
        name AS customer_name,
        COALESCE(SUM(payment), 0) AS amount,
        COUNT(*) AS count
      FROM death_settle
      WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
        AND approval_status = 'approved'
      ${branch && branch !== "all" ? " AND bname = ?" : ""}
      GROUP BY name
      ORDER BY amount DESC
      LIMIT 10
    `;
    const customerParams = [month];
    if (branch && branch !== "all") {
      customerParams.push(branch);
    }
    const topCustomers = await mainDb.query(customerQuery, customerParams);

    // Get top branches
    const branchQuery = `
      SELECT
        bname AS branch,
        COALESCE(SUM(payment), 0) AS total_amount,
        COUNT(*) AS settlement_count
      FROM death_settle
      WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
        AND approval_status = 'approved'
      ${branch && branch !== "all" ? " AND bname = ?" : ""}
      GROUP BY bname
      ORDER BY total_amount DESC
      LIMIT 10
    `;
    const branchParams = [month];
    if (branch && branch !== "all") {
      branchParams.push(branch);
    }
    const topBranches = await mainDb.query(branchQuery, branchParams);

    // Get monthly trend
    const trendQuery = `
      SELECT
        DATE(payment_date) AS date,
        COALESCE(SUM(payment), 0) AS daily_total,
        COUNT(*) AS daily_count
      FROM death_settle
      WHERE DATE_FORMAT(payment_date, '%Y-%m') = ?
        AND approval_status = 'approved'
      ${branch && branch !== "all" ? " AND bname = ?" : ""}
      GROUP BY DATE(payment_date)
      ORDER BY date
    `;
    const trendParams = [month];
    if (branch && branch !== "all") {
      trendParams.push(branch);
    }
    const trendData = await mainDb.query(trendQuery, trendParams);

    const row = rows[0] || {};

    const branches = await mainDb.query(
      `SELECT DISTINCT bname AS branch FROM death_settle 
       WHERE DATE_FORMAT(payment_date, '%Y-%m') = ? 
         AND approval_status = 'approved' 
       ORDER BY branch`,
      [month],
    );

    return {
      month,
      type: "company",
      branch: branch || "all",
      summary: {
        total_amount: Number(row.total_amount || 0),
        settlement_count: Number(row.settlement_count || 0),
        branch_count: Number(row.branch_count || 0),
        customer_count: Number(row.customer_count || 0),
      },
      top_customers: topCustomers.map((cust) => ({
        customer_name: cust.customer_name || "Unknown",
        amount: Number(cust.amount || 0),
        count: Number(cust.count || 0),
      })),
      top_branches: topBranches.map((b) => ({
        branch: b.branch || "Unknown",
        total_amount: Number(b.total_amount || 0),
        settlement_count: Number(b.settlement_count || 0),
      })),
      trend: trendData.map((t) => ({
        date: t.date,
        daily_total: Number(t.daily_total || 0),
        daily_count: Number(t.daily_count || 0),
      })),
      branches: branches.map((b) => b.branch),
      total: Number(row.total_amount || 0),
    };
  } catch (error) {
    logger.error("[DeathSettlements] Error fetching death settlements:", error);
    throw error;
  }
}

module.exports = {
  getBranchExpenses,
  getDeathSettlements,
};
