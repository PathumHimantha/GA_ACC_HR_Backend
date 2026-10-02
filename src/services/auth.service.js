const adminDb = require("../db/adminDb");

async function storeLoginAudit(userId) {
  await adminDb.query(
    `INSERT INTO admin_audit_log (action, performed_by, created_at) VALUES (?, ?, NOW())`,
    ["login", userId],
  );
}

module.exports = { storeLoginAudit };
