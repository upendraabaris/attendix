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

const getYearBounds = (year) => ({
  start: `${year}-01-01`,
  end: `${year}-12-31`,
});

const getPresentWorkingDays = async (employeeId, year) => {
  const { start, end } = getYearBounds(year);

  const result = await pool.query(
    `
      SELECT COUNT(distinct a.date)::int AS present_days
      FROM get_particular_attendance($1, $2, $3) a
      WHERE a.clock_in IS NOT NULL
        AND a.clock_out IS NOT NULL
    `,
    [employeeId, start, end]
  );

  return Number(result.rows[0]?.present_days || 0);
};

const getEarnedPolicyForEmployee = async (employeeId,type) => {
  const result = await pool.query(
    `
      SELECT
        lp.organization_id,
        lp.leave_type,
        lp.is_enabled,
        lp.earned_days_required,
        lp.earned_leave_award
      FROM employees e
      JOIN leave_policies lp
        ON lp.organization_id = e.organization_id
      WHERE e.id = $1
        AND lp.leave_type = $2
      LIMIT 1
    `,
    [employeeId,type]
  );

  return result.rows[0] || null;
};

const getConsumedEarnedLeaveDays = async (employeeId, year,type) => {
  const { start, end } = getYearBounds(year);
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(lr.end_date - lr.start_date + 1), 0)::numeric AS consumed_days
      FROM leave_requests lr
      WHERE lr.employee_id = $1
        AND lr.type = $4
        AND lr.status = 'approved'
        AND lr.start_date <= $3::date
        AND lr.end_date >= $2::date
    `,
    [employeeId, start, end,type]
  );

  return Number(result.rows[0]?.consumed_days || 0);
};

const syncEarnedLeaveBalanceForEmployee = async (employeeId,type = 'earned', date = new Date()) => {
  const year = date.getUTCFullYear();
  const policy = await getEarnedPolicyForEmployee(employeeId,type);

  if (
    !policy ||
    !policy.is_enabled ||
    !policy.earned_days_required ||
    !policy.earned_leave_award
  ) {
    return {
      synced: false,
      reason: `${type} policy missing_or_disabled`,
      balance: 0,
    };
  }

  const presentDays = await getPresentWorkingDays(employeeId, year);
  const consumedEarnedDays = await getConsumedEarnedLeaveDays(employeeId, year,type);

  const totalEarnedCredits =
    Math.floor(presentDays / Number(policy.earned_days_required)) *
    Number(policy.earned_leave_award);
  const availableBalance = Math.max(totalEarnedCredits - consumedEarnedDays, 0);

  const upserted = await upsertEmployeeLeaveBalance({
    employeeId,
    leaveType: type,
    usedDays: consumedEarnedDays,
    balance: availableBalance,
  });

  return {
    synced: true,
    presentDays,
    consumedEarnedDays,
    totalEarnedCredits,
    balance: Number(upserted.balance || 0),
  };
};

module.exports = {
  getEmployeeLeaveBalances,
  getEmployeeLeaveBalanceByType,
  upsertEmployeeLeaveBalance,
  syncEarnedLeaveBalanceForEmployee,
};
