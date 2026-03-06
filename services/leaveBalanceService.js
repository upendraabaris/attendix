const pool = require("../configure/dbConfig");

const getEmployeeLeaveBalances = async (employeeId) => {
  const result = await pool.query(
    `
      SELECT id, employee_id, leave_type, used_days, balance, updated_at
      FROM employee_leave_balance
      WHERE employee_id = $1
      ORDER BY leave_type
    `,
    [employeeId]
  );
  return result.rows;
};

const getEmployeeLeaveBalanceByType = async (employeeId, leaveType) => {
  const result = await pool.query(
    `
      SELECT id, employee_id, leave_type, used_days, balance, updated_at
      FROM employee_leave_balance
      WHERE employee_id = $1
        AND leave_type = $2
      LIMIT 1
    `,
    [employeeId, leaveType]
  );
  return result.rows[0] || null;
};

const upsertEmployeeLeaveBalance = async ({
  employeeId,
  leaveType,
  usedDays = 0,
  balance = 0,
}) => {
  const result = await pool.query(
    `
      INSERT INTO employee_leave_balance (employee_id, leave_type, used_days, balance, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (employee_id, leave_type)
      DO UPDATE SET
        used_days = EXCLUDED.used_days,
        balance = EXCLUDED.balance,
        updated_at = NOW()
      RETURNING *
    `,
    [employeeId, leaveType, usedDays, balance]
  );
  return result.rows[0];
};

module.exports = {
  getEmployeeLeaveBalances,
  getEmployeeLeaveBalanceByType,
  upsertEmployeeLeaveBalance,
};
