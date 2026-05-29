const pool = require("../configure/dbConfig");
const { getCompOffBalance } = require("./compOffService");

// const getEmployeeLeaveBalances = async (employeeId) => {
//   const result = await pool.query(
//     `
//       SELECT id, employee_id, leave_type, used_days, balance, updated_at
//       FROM employee_leave_balance
//       WHERE employee_id = $1
//         AND leave_type <> 'vacation'
//       ORDER BY leave_type
//     `,
//     [employeeId]
//   );

//   const balances = await Promise.all(
//     result.rows.map(async (row) => {
//       const pendingDays = await getPendingLeaveDays(employeeId, row.leave_type);
//       const grossBalance = Number(row.balance || 0);

//       return {
//         ...row,
//         accrued_balance: grossBalance,
//         pending_days: pendingDays,
//         balance: Math.max(grossBalance - pendingDays, 0),
//       };
//     })
//   );

//   return balances;
// };

const getEmployeeLeaveBalances = async (employeeId) => {
  // 
  const result = await pool.query(
  `
  SELECT
    lp.leave_type,

    COALESCE(elb.id, 0) AS id,

    $1 AS employee_id,

    COALESCE(elb.used_days, 0) AS used_days,

    COALESCE(elb.balance, lp.yearly_limit, 0) AS balance,

    elb.updated_at

  FROM leave_policies lp

  LEFT JOIN employee_leave_balance elb
    ON elb.leave_type = lp.leave_type
    AND elb.employee_id = $1

  JOIN employees e
    ON e.organization_id = lp.organization_id

  WHERE e.id = $1
    AND lp.leave_type <> 'vacation'
    AND lp.is_enabled = true

  ORDER BY lp.leave_type
  `,
  [employeeId]
);

  const balances = await Promise.all(
    result.rows.map(async (row) => {
      const pendingDays = await getPendingLeaveDays(
        employeeId,
        row.leave_type
      );

      const grossBalance = Number(row.balance || 0);

      return {
        ...row,
        accrued_balance: grossBalance,
        pending_days: pendingDays,
        balance: Math.max(grossBalance - pendingDays, 0),
      };
    })
  );

  return balances;
};

const mergeCompOffIntoBalances = async (employeeId, organizationId, balances = []) => {
  const nextBalances = [...balances];

  try {
    const compOffBalance = await getCompOffBalance(employeeId, organizationId);
    if (!compOffBalance) {
      return nextBalances;
    }

    const compensationBalance = {
      id: `comp-${compOffBalance.employee_id || employeeId}`,
      employee_id: employeeId,
      leave_type: "compensation",
      used_days: Number(compOffBalance.used_count || 0),
      balance: Number(compOffBalance.available_balance || 0),
      accrued_balance: Number(compOffBalance.available_balance || 0),
      pending_days: Number(compOffBalance.pending_days || 0),
      updated_at: null,
    };

    const existingIndex = nextBalances.findIndex(
      (item) => item.leave_type === "compensation"
    );

    if (existingIndex >= 0) {
      nextBalances[existingIndex] = compensationBalance;
    } else {
      nextBalances.push(compensationBalance);
    }
  } catch (error) {
    console.error(
      `Comp off balance sync failed for employee ${employeeId}:`,
      error.message
    );
  }

  return nextBalances;
};

const getLeaveTypesForBalance = (leaveType) =>
  leaveType === "earned" ? ["earned", "vacation"] : [leaveType];

const getPendingLeaveDays = async (employeeId, leaveType) => {
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(
        CASE WHEN lr.is_half_day THEN 0.5
             ELSE (lr.end_date - lr.start_date + 1)::numeric
        END
      ), 0)::numeric AS pending_days
      FROM leave_requests lr
      WHERE lr.employee_id = $1
        AND lr.type = ANY($2::text[])
        AND lr.status = 'pending'
    `,
    [employeeId, getLeaveTypesForBalance(leaveType)]
  );

  return Number(result.rows[0]?.pending_days || 0);
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

const EARNED_LEAVE_ANNUAL_LIMIT = 12;
const EARNED_LEAVE_CARRY_FORWARD_LIMIT = 24;

const getCompletedAccrualMonths = (date, joinedAt) => {
  const accrualDate = new Date(date);
  const yearStart = new Date(Date.UTC(accrualDate.getUTCFullYear(), 0, 1));
  const joinDate = joinedAt ? new Date(joinedAt) : yearStart;

  if (Number.isNaN(joinDate.getTime())) {
    return Math.max(accrualDate.getUTCMonth(), 0);
  }

  const accrualYear = accrualDate.getUTCFullYear();
  const accrualStart = joinDate.getUTCFullYear() === accrualYear && joinDate > yearStart
    ? joinDate
    : yearStart;

  if (accrualStart > accrualDate) {
    return 0;
  }

  let completedMonths =
    (accrualDate.getUTCFullYear() - accrualStart.getUTCFullYear()) * 12 +
    (accrualDate.getUTCMonth() - accrualStart.getUTCMonth());

  if (accrualDate.getUTCDate() < accrualStart.getUTCDate()) {
    completedMonths -= 1;
  }

  return Math.max(completedMonths, 0);
};

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
        lp.yearly_limit,
        lp.earned_days_required,
        lp.earned_leave_award,
        e.created_at AS employee_created_at
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
  const consumedTypes = type === "earned" ? ["earned", "vacation"] : [type];
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(
        CASE WHEN lr.is_half_day THEN 0.5
             ELSE (lr.end_date - lr.start_date + 1)::numeric
        END
      ), 0)::numeric AS consumed_days
      FROM leave_requests lr
      WHERE lr.employee_id = $1
        AND lr.type = ANY($4::text[])
        AND lr.status = 'approved'
        AND lr.start_date <= $3::date
        AND lr.end_date >= $2::date
    `,
    [employeeId, start, end, consumedTypes]
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

  const consumedEarnedDays = await getConsumedEarnedLeaveDays(employeeId, year,type);

  let presentDays = null;
  let totalEarnedCredits = 0;
  let availableBalance = 0;

  if (type === "earned") {
    const annualLimit = Number(policy.yearly_limit || EARNED_LEAVE_ANNUAL_LIMIT);
    const monthlyAward = Number(policy.earned_leave_award);
    const accruedMonths = getCompletedAccrualMonths(date, policy.employee_created_at);
    totalEarnedCredits = Math.min(accruedMonths * monthlyAward, annualLimit);
    availableBalance = Math.min(
      Math.max(totalEarnedCredits - consumedEarnedDays, 0),
      EARNED_LEAVE_CARRY_FORWARD_LIMIT
    );
  } else {
    presentDays = await getPresentWorkingDays(employeeId, year);
    totalEarnedCredits =
      Math.floor(presentDays / Number(policy.earned_days_required)) *
      Number(policy.earned_leave_award);
    availableBalance = Math.max(totalEarnedCredits - consumedEarnedDays, 0);
  }

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

const getOrganizationLeaveBalanceReport = async (organizationId) => {
  const employeeResult = await pool.query(
    `
      SELECT
        e.id AS employee_id,
        e.name AS employee_name,
        e.email,
        e.role,
        COALESCE(e.status, 'active') AS status
      FROM employees e
      WHERE e.organization_id = $1
        AND COALESCE(e.status, 'active') = 'active'
      ORDER BY
        CASE WHEN LOWER(e.role) = 'admin' THEN 0 ELSE 1 END,
        e.name ASC
    `,
    [organizationId]
  );

  const report = await Promise.all(
    employeeResult.rows.map(async (employee) => {
      try {
        await syncEarnedLeaveBalanceForEmployee(employee.employee_id, "earned");
      } catch (syncErr) {
        console.error(
          `Earned leave sync failed for employee ${employee.employee_id}:`,
          syncErr.message
        );
      }

      try {
        await syncEarnedLeaveBalanceForEmployee(employee.employee_id, "casual");
      } catch (syncErr) {
        console.error(
          `Casual leave sync failed for employee ${employee.employee_id}:`,
          syncErr.message
        );
      }

      const balances = await mergeCompOffIntoBalances(
        employee.employee_id,
        organizationId,
        await getEmployeeLeaveBalances(employee.employee_id)
      );

      const balanceMap = balances.reduce((acc, balance) => {
        acc[balance.leave_type] = {
          leave_type: balance.leave_type,
          balance: Number(balance.balance || 0),
          accrued_balance: Number(balance.accrued_balance ?? balance.balance ?? 0),
          used_days: Number(balance.used_days || 0),
          pending_days: Number(balance.pending_days || 0),
        };
        return acc;
      }, {});

      return {
        ...employee,
        balances,
        balances_by_type: balanceMap,
      };
    })
  );

  return report;
};

module.exports = {
  getEmployeeLeaveBalances,
  getEmployeeLeaveBalanceByType,
  upsertEmployeeLeaveBalance,
  syncEarnedLeaveBalanceForEmployee,
  getOrganizationLeaveBalanceReport,
};
