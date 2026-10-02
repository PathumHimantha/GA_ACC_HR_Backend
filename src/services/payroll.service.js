const mainDb = require("../db/mainDb");
const adminDb = require("../db/adminDb");

/**
 * Get all employees with active status
 * @param {string} month - Month filter (YYYY-MM)
 * @param {string} type - Type filter (optional)
 * @returns {Promise<Object>} - Employees data with summary
 */
const getemployees = async (month, type) => {
  try {
    // Get all users from usertable - use adminDb since usertable is in admin database
    const query = `
      SELECT 
        id,
        name,
        email,
        code,
        bname,
        bcode,
        status,
        user_status
      FROM usertable 
      WHERE user_status = 'active'
      ORDER BY name ASC
    `;

    // Execute query - handle different return formats
    const result = await mainDb.query(query);

    // 🔥 FIX: Handle different result formats
    let rows = [];
    if (Array.isArray(result)) {
      // Check if result[0] is the data array (mysql2/promise format)
      if (result.length > 0 && Array.isArray(result[0])) {
        rows = result[0];
      } else {
        rows = result;
      }
    } else if (result && typeof result === "object") {
      // If result is an object with rows property
      if (result.rows && Array.isArray(result.rows)) {
        rows = result.rows;
      } else if (result[0] && Array.isArray(result[0])) {
        rows = result[0];
      }
    }

    console.log("Found users:", rows?.length || 0); // Debug log

    // If no users found, return empty result
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return {
        success: true,
        data: [],
        total: 0,
        summary: {
          totalEmployees: 0,
          activeEmployees: 0,
          onProbation: 0,
          monthlyGross: 0,
          activePercentage: 0,
        },
      };
    }

    // Map users to employee format with additional fields
    const employees = rows.map((user) => {
      const designation = getDesignation(user);
      const department = getDepartment(user);
      const grossSalary = getGrossSalary(user);
      const status = getUserStatus(user);

      return {
        id: user.id.toString(),
        emp_no: user.code || `GA-${String(user.id).padStart(4, "0")}`,
        name: user.name || "Unknown",
        email: user.email || "",
        designation: designation,
        department: department,
        gross_salary: grossSalary,
        status: status,
        epf_no: "", // No EPF field in usertable
        branch: user.bname || "",
        join_date: null, // No join_date field in usertable
        user_status: user.user_status || "",
      };
    });

    // Calculate summary statistics
    const activeEmployees = employees.filter(
      (e) => e.status === "Active",
    ).length;
    const onProbation = employees.filter(
      (e) => e.status === "On Probation",
    ).length;
    const totalGross = employees.reduce((sum, e) => sum + e.gross_salary, 0);

    const summary = {
      totalEmployees: employees.length,
      activeEmployees: activeEmployees,
      onProbation: onProbation,
      monthlyGross: totalGross,
      activePercentage:
        employees.length > 0 ? (activeEmployees / employees.length) * 100 : 0,
    };

    // Apply month filter if provided (skip since no join_date)
    let filteredEmployees = employees;
    if (month) {
      // Since we don't have join_date, we'll just return all employees
      console.log("Month filter applied but no join_date available");
    }

    // Apply type filter if provided
    if (type && type !== "all") {
      filteredEmployees = filteredEmployees.filter(
        (emp) =>
          emp.department?.toLowerCase() === type.toLowerCase() ||
          emp.designation?.toLowerCase() === type.toLowerCase() ||
          emp.user_status?.toLowerCase() === type.toLowerCase(),
      );
    }

    return {
      success: true,
      data: filteredEmployees,
      total: filteredEmployees.length,
      summary: summary,
      departments: getUniqueDepartments(employees),
      allData: employees, // Full data for reference
    };
  } catch (error) {
    console.error("Error in getemployees:", error);
    throw new Error(`Failed to fetch employees: ${error.message}`);
  }
};

/**
 * Helper function to determine designation based on user data
 */
const getDesignation = (user) => {
  // Map user_status to designation
  const designationMap = {
    admin: "System Administrator",
    branch_manager: "Branch Manager",
    zone_head: "Zone Head",
    regional_manager: "Regional Manager",
    executive: "Executive",
    officer: "Officer",
    teller: "Teller",
    staff: "Staff",
    manager: "Manager",
  };

  // Try to determine from user_status
  if (user.user_status) {
    const status = user.user_status.toLowerCase();
    if (designationMap[status]) {
      return designationMap[status];
    }

    // Partial matches
    if (status.includes("admin")) return "Administrator";
    if (status.includes("manager")) return "Manager";
    if (status.includes("executive")) return "Executive";
    if (status.includes("officer")) return "Officer";
    if (status.includes("teller")) return "Teller";
    if (status.includes("head")) return "Head";
  }

  return "Staff Member";
};

/**
 * Helper function to determine department based on user data
 */
const getDepartment = (user) => {
  // Map user_status to department
  const departmentMap = {
    admin: "Administration",
    branch_manager: "Branch Operations",
    zone_head: "Zone Management",
    regional_manager: "Regional Management",
    executive: "Operations",
    officer: "Operations",
    teller: "Customer Service",
  };

  if (user.user_status) {
    const status = user.user_status.toLowerCase();
    if (departmentMap[status]) {
      return departmentMap[status];
    }

    // Check for department in status
    if (status.includes("admin")) return "Administration";
    if (status.includes("branch_manager")) return "Branch Operations";
    if (status.includes("finance")) return "Finance";
    if (status.includes("credit")) return "Credit";
    if (status.includes("marketing")) return "Marketing";
    if (status.includes("operations")) return "Operations";
  }

  // Default department based on branch
  if (user.bname && user.bname !== "ADMIN") {
    return user.bname;
  }

  return "General";
};

/**
 * Helper function to get gross salary
 * You may need to fetch this from a salary table
 */
const getGrossSalary = (user) => {
  // Default salary ranges based on user_status
  const salaryRanges = {
    admin: 450000,
    zone_head: 350000,
    regional_manager: 320000,
    branch_manager: 250000,
    manager: 250000,
    executive: 150000,
    officer: 120000,
    teller: 80000,
    staff: 100000,
  };

  // Default salary based on user_status
  const status = user.user_status?.toLowerCase() || "";

  // Exact match
  if (salaryRanges[status]) {
    return salaryRanges[status];
  }

  // Partial match
  for (const [key, value] of Object.entries(salaryRanges)) {
    if (status.includes(key)) {
      return value;
    }
  }

  return 100000; // Default salary
};

/**
 * Helper function to determine employee status
 */
const getUserStatus = (user) => {
  // Default based on status field from database
  if (user.user_status === "active") {
    return "Active";
  }
  return "Inactive";
};

/**
 * Get unique departments from employees list
 */
const getUniqueDepartments = (employees) => {
  const depts = new Set();
  employees.forEach((emp) => {
    if (emp.department) {
      depts.add(emp.department);
    }
  });
  return Array.from(depts);
};

/**
 * Get employee by ID
 */
const getEmployeeById = async (id) => {
  try {
    const query = `SELECT * FROM usertable WHERE id = ? AND status = 'active'`;
    const result = await adminDb.query(query, [id]);

    // Handle different result formats
    let rows = [];
    if (Array.isArray(result)) {
      if (result.length > 0 && Array.isArray(result[0])) {
        rows = result[0];
      } else {
        rows = result;
      }
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    return rows[0];
  } catch (error) {
    console.error("Error in getEmployeeById:", error);
    throw error;
  }
};

/**
 * Update employee status
 */
const updateEmployeeStatus = async (id, status) => {
  try {
    const query = `UPDATE usertable SET user_status = ? WHERE id = ?`;
    await adminDb.query(query, [status, id]);
    return { success: true, message: "Employee status updated successfully" };
  } catch (error) {
    console.error("Error in updateEmployeeStatus:", error);
    throw error;
  }
};

module.exports = {
  getemployees,
  getEmployeeById,
  updateEmployeeStatus,
};
