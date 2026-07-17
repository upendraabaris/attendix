const pool = require("../configure/dbConfig");
const { getCompOffBalance } = require("./compOffService");
const { getLeaveCycle } = require("./leaveCycleHelper");

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

const getEmployeeOrgInfo = async (employeeId) => {
  const result = await pool.query(
    `
      SELECT
        e.created_at AS joining_date,
        COALESCE(o.leave_renewal_type, 'date_of_joining') AS leave_renewal_type
      FROM employees e
      LEFT JOIN organizations o ON o.id = e.organization_id
      WHERE e.id = $1
      LIMIT 1
    `,
    [employeeId]
  );

  return {
    joiningDate: result.rows[0]?.joining_date || null,
    renewalType: result.rows[0]?.leave_renewal_type || "date_of_joining",
  };
};

const getEmployeeLeaveBalances = async (employeeId) => {
  const { joiningDate, renewalType } = await getEmployeeOrgInfo(employeeId);
  const { start: cycleStart, end: cycleEnd } = getLeaveCycle(joiningDate, new Date(), renewalType);

  // 
//   const result = await pool.query(
//   `
//   SELECT
//     lp.leave_type,

//     COALESCE(elb.id, 0) AS id,

//     $1 AS employee_id,

//     COALESCE(elb.used_days, 0) AS used_days,

//     COALESCE(elb.balance, lp.yearly_limit, 0) AS balance,

//     elb.updated_at

//   FROM leave_policies lp

//   LEFT JOIN employee_leave_balance elb
//     ON elb.leave_type = lp.leave_type
//     AND elb.employee_id = $1

//   JOIN employees e
//     ON e.organization_id = lp.organization_id

//   WHERE e.id = $1
//     AND lp.leave_type <> 'vacation'
//     AND lp.is_enabled = true

//   ORDER BY lp.leave_type
//   `,
//   [employeeId]
// );
const result = await pool.query(
  `
  SELECT
    lp.leave_type,

    COALESCE(elb.id, 0) AS id,

    $1 AS employee_id,

    COALESCE(
      CASE
        WHEN lp.leave_type IN ('earned', 'casual') THEN elb.used_days
        ELSE used_data.used_days
      END,
      0
    ) AS used_days,

    CASE
      WHEN lp.leave_type IN ('earned', 'casual')
        THEN COALESCE(elb.balance, 0)

      ELSE GREATEST(
        lp.yearly_limit - COALESCE(used_data.used_days, 0) + COALESCE(elb.carry_forward_balance, 0),
        0
      )
    END AS balance,

    elb.updated_at

  FROM leave_policies lp

  LEFT JOIN employee_leave_balance elb
    ON elb.leave_type = lp.leave_type
    AND elb.employee_id = $1

  LEFT JOIN (
    SELECT
      lr.type,

      SUM(
        CASE
          WHEN lr.is_half_day THEN 0.5
          ELSE (
            LEAST(lr.end_date, $3::date) - GREATEST(lr.start_date, $2::date) + 1
          )
        END
      ) AS used_days

    FROM leave_requests lr

    WHERE lr.employee_id = $1
      AND lr.status = 'approved'
      AND lr.type NOT IN ('earned', 'casual', 'vacation')
      AND lr.start_date <= $3::date
      AND lr.end_date >= $2::date

    GROUP BY lr.type
  ) used_data
    ON used_data.type = lp.leave_type

  JOIN employees e
    ON e.organization_id = lp.organization_id

  WHERE e.id = $1
    AND lp.leave_type <> 'vacation'
    AND lp.is_enabled = true

  ORDER BY lp.leave_type
  `,
  [employeeId, cycleStart, cycleEnd]
);

  // const balances = await Promise.all(
  //   result.rows.map(async (row) => {
  //     const pendingDays = await getPendingLeaveDays(
  //       employeeId,
  //       row.leave_type
  //     );

  //     const grossBalance = Number(row.balance || 0);

  //     return {
  //       ...row,
  //       accrued_balance: grossBalance,
  //       pending_days: pendingDays,
  //       balance: Math.max(grossBalance - pendingDays, 0),
  //     };
  //   })
  // );
  const balances = await Promise.all(
  result.rows.map(async (row) => {
    const pendingDays = await getPendingLeaveDays(
      employeeId,
      row.leave_type
    );

    return {
      ...row,
      accrued_balance: Number(row.balance || 0),
      pending_days: pendingDays,
      balance: Number(row.balance || 0),
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
  cycleStart = null,
  cycleEnd = null,
  carryForwardBalance = null, // null = do not update carry_forward_balance
}) => {
  const result = await pool.query(
    `
      INSERT INTO employee_leave_balance
        (employee_id, leave_type, used_days, balance, cycle_start, cycle_end, carry_forward_balance, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0), NOW())
      ON CONFLICT (employee_id, leave_type)
      DO UPDATE SET
        used_days             = EXCLUDED.used_days,
        balance               = EXCLUDED.balance,
        cycle_start           = EXCLUDED.cycle_start,
        cycle_end             = EXCLUDED.cycle_end,
        carry_forward_balance = CASE
          WHEN $7 IS NOT NULL THEN EXCLUDED.carry_forward_balance
          ELSE employee_leave_balance.carry_forward_balance
        END,
        updated_at  = NOW()
      RETURNING *
    `,
    [employeeId, leaveType, usedDays, balance, cycleStart, cycleEnd, carryForwardBalance]
  );
  return result.rows[0];
};

/**
 * Archives the expired balance for a completed leave cycle into the history table.
 * Called automatically when syncEarnedLeaveBalanceForEmployee detects a cycle change.
 */
const archiveExpiredLeaveBalance = async ({
  employeeId,
  leaveType,
  cycleStart,
  cycleEnd,
  earnedDays,
  usedDays,
  expiredDays,
  renewalType = 'date_of_joining',    // NEW: stored so history can be filtered by renewal mode
}) => {
  try {
    await pool.query(
      `
        INSERT INTO employee_leave_balance_history
          (employee_id, leave_type, cycle_start, cycle_end, earned_days, used_days, expired_days, renewal_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (employee_id, leave_type, cycle_start) DO NOTHING
      `,
      [
        employeeId,
        leaveType,
        cycleStart,
        cycleEnd,
        earnedDays,
        usedDays,
        Math.max(Number(expiredDays), 0),
        renewalType,
      ]
    );
  } catch (err) {
    console.error(
      `Failed to archive leave balance history for employee ${employeeId} (${leaveType}):`,
      err.message
    );
  }
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

const getPresentWorkingDays = async (employeeId, cycleStart, cycleEnd) => {
  const result = await pool.query(
    `
      SELECT COUNT(distinct a.date)::int AS present_days
      FROM get_particular_attendance($1, $2, $3) a
      WHERE a.clock_in IS NOT NULL
        AND a.clock_out IS NOT NULL
    `,
    [employeeId, cycleStart, cycleEnd]
  );

  return Number(result.rows[0]?.present_days || 0);
};

const getEarnedPolicyForEmployee = async (employeeId, type) => {
  const result = await pool.query(
    `
      SELECT
        lp.organization_id,
        lp.leave_type,
        lp.is_enabled,
        lp.yearly_limit,
        lp.earned_days_required,
        lp.earned_leave_award,
        lp.carry_forward_enabled,
        e.created_at AS employee_created_at,
        COALESCE(o.leave_renewal_type, 'date_of_joining') AS leave_renewal_type
      FROM employees e
      JOIN leave_policies lp
        ON lp.organization_id = e.organization_id
      LEFT JOIN organizations o ON o.id = e.organization_id
      WHERE e.id = $1
        AND lp.leave_type = $2
      LIMIT 1
    `,
    [employeeId, type]
  );

  return result.rows[0] || null;
};

const getConsumedEarnedLeaveDays = async (employeeId, cycleStart, cycleEnd, type) => {
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
    [employeeId, cycleStart, cycleEnd, consumedTypes]
  );

  return Number(result.rows[0]?.consumed_days || 0);
};

const syncEarnedLeaveBalanceForEmployee = async (employeeId, type = 'earned', date = new Date()) => {
  // carryForwardDays will be set during cycle rollover detection if CF is enabled
  let carryForwardDays = 0;
  const policy = await getEarnedPolicyForEmployee(employeeId, type);

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

  const renewalType = policy.leave_renewal_type || "date_of_joining";

  // Compute current cycle bounds based on renewal type
  const { start: cycleStart, end: cycleEnd } = getLeaveCycle(
    policy.employee_created_at,
    date,
    renewalType
  );

  // ── Cycle Change Detection ──────────────────────────────────────────────────
  // Fetch the existing DB row to check which cycle it belongs to.
  const existingRow = await getEmployeeLeaveBalanceByType(employeeId, type);

  // Today's date as a plain YYYY-MM-DD string for safe date-only comparison
  const todayStr = new Date().toISOString().split('T')[0];

  if (existingRow && existingRow.cycle_start) {
    // Case A: Row has a cycle_start — check if the cycle has genuinely rolled over
    const storedCycleStart = new Date(existingRow.cycle_start).toISOString().split('T')[0];
    const storedCycleEnd   = existingRow.cycle_end
      ? new Date(existingRow.cycle_end).toISOString().split('T')[0]
      : null;

    if (storedCycleStart !== cycleStart) {
      // Guard: only archive if the stored cycle has actually ENDED.
      // If storedCycleEnd >= today the org just switched renewal modes (DOJ ↔ Calendar Year)
      // and the "old" cycle is still active under the previous mode — do NOT archive it.
      if (storedCycleEnd && storedCycleEnd < todayStr) {
        const unusedBalance = Number(existingRow.balance || 0);
        const carryForwardEnabled = Boolean(policy.carry_forward_enabled);

        await archiveExpiredLeaveBalance({
          employeeId,
          leaveType: type,
          cycleStart: storedCycleStart,
          cycleEnd:   storedCycleEnd,
          earnedDays: Number(existingRow.used_days || 0) + unusedBalance,
          usedDays:   Number(existingRow.used_days || 0),
          // If carry-forward is ON, nothing expires — days move to next cycle
          expiredDays: carryForwardEnabled ? 0 : unusedBalance,
          renewalType,
        });

        // Store carry-forward days to be added to the new cycle's balance
        carryForwardDays = carryForwardEnabled ? unusedBalance : 0;

        console.log(
          `[LeaveSync] Cycle rolled over for employee ${employeeId} (${type}). ` +
          `Previous: ${storedCycleStart}→${storedCycleEnd}, New: ${cycleStart}. ` +
          `CarryForward=${carryForwardEnabled}, carried=${carryForwardDays}, expired=${carryForwardEnabled ? 0 : unusedBalance}`
        );
      } else {
        // Renewal mode changed but cycle hasn't ended — just reset tracking, no archive.
        console.log(
          `[LeaveSync] Renewal mode change detected for employee ${employeeId} (${type}). ` +
          `Stored cycle ${storedCycleStart}→${storedCycleEnd} not yet ended. Skipping archive.`
        );
      }
    }

  } else if (existingRow && !existingRow.cycle_start) {
    // Case B: Row exists but cycle_start is NULL (pre-migration / first sync after feature deploy).
    // Look back one cycle and archive it so the admin immediately sees last year's expired data.
    try {
      const prevCycleRef = new Date(cycleStart);
      prevCycleRef.setUTCDate(prevCycleRef.getUTCDate() - 1); // one day before current cycle start

      const { start: prevCycleStart, end: prevCycleEnd } = getLeaveCycle(
        policy.employee_created_at,
        prevCycleRef,
        renewalType
      );

      // Guard 1: previous cycle must be a genuinely different (earlier) cycle.
      // Guard 2: previous cycle must have actually ended (cycle_end < today).
      // Guard 3: the employee must have been active during the previous cycle
      //          (joining date on or before the last day of that cycle).
      //          For DOJ mode: joiningDate=2025-08-01, prevCycleEnd=2025-07-31 → blocked (phantom).
      //          For Calendar Year: joiningDate=2025-08-01, prevCycleEnd=2025-12-31 → allowed.
      const joiningDateStr = new Date(policy.employee_created_at).toISOString().split('T')[0];
      if (prevCycleStart < cycleStart && prevCycleEnd < todayStr && joiningDateStr <= prevCycleEnd) {
        const prevConsumed = await getConsumedEarnedLeaveDays(
          employeeId, prevCycleStart, prevCycleEnd, type
        );
        const prevPresentDays = await getPresentWorkingDays(employeeId, prevCycleStart, prevCycleEnd);
        const prevEarnedCredits =
          Math.floor(prevPresentDays / Number(policy.earned_days_required)) *
          Number(policy.earned_leave_award);

        let prevAvailableBalance = 0;
        if (type === 'earned') {
          const netBalance = Math.max(prevEarnedCredits - prevConsumed, 0);
          const yearlyLimitVal = Number(policy.yearly_limit || 0);
          prevAvailableBalance = yearlyLimitVal > 0
            ? Math.min(netBalance, yearlyLimitVal)
            : netBalance;
        } else {
          prevAvailableBalance = Math.max(prevEarnedCredits - prevConsumed, 0);
        }

        if (prevEarnedCredits > 0 || prevConsumed > 0) {
          const carryForwardEnabled = Boolean(policy.carry_forward_enabled);

          await archiveExpiredLeaveBalance({
            employeeId,
            leaveType:   type,
            cycleStart:  prevCycleStart,
            cycleEnd:    prevCycleEnd,
            earnedDays:  prevEarnedCredits,
            usedDays:    prevConsumed,
            // If carry-forward is ON, nothing expires — days move to next cycle
            expiredDays: carryForwardEnabled ? 0 : prevAvailableBalance,
            renewalType,
          });

          // Store carry-forward days to be added to the new cycle's balance
          carryForwardDays = carryForwardEnabled ? prevAvailableBalance : 0;

          console.log(
            `[LeaveSync] Backfilled previous cycle for employee ${employeeId} (${type}). ` +
            `Cycle: ${prevCycleStart}→${prevCycleEnd}. ` +
            `CarryForward=${carryForwardEnabled}, carried=${carryForwardDays}, expired=${carryForwardEnabled ? 0 : prevAvailableBalance}`
          );
        }
      } else if (prevCycleStart >= cycleStart) {
        console.log(
          `[LeaveSync] No completed previous cycle for employee ${employeeId} (${type}). ` +
          `Cycle ${prevCycleStart}→${prevCycleEnd} is not before current ${cycleStart}.`
        );
      } else {
        // prevCycleEnd >= todayStr — previous cycle hasn't ended yet (employee just joined)
        console.log(
          `[LeaveSync] Employee ${employeeId} (${type}): previous cycle ${prevCycleStart}→${prevCycleEnd} not yet ended. No backfill.`
        );
      }
    } catch (backfillErr) {
      console.warn(
        `[LeaveSync] Could not backfill previous cycle for employee ${employeeId} (${type}):`,
        backfillErr.message
      );
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // getConsumedEarnedLeaveDays already filters by cycleStart–cycleEnd,
  // so in a new cycle this will naturally return 0.
  const consumedEarnedDays = await getConsumedEarnedLeaveDays(employeeId, cycleStart, cycleEnd, type);

  const presentDays = await getPresentWorkingDays(employeeId, cycleStart, cycleEnd);
  const totalEarnedCredits =
    Math.floor(presentDays / Number(policy.earned_days_required)) *
    Number(policy.earned_leave_award);

  let availableBalance = 0;
  if (type === "earned") {
    const netBalance = Math.max(totalEarnedCredits - consumedEarnedDays, 0);
    const yearlyLimitVal = Number(policy.yearly_limit || 0);
    availableBalance = yearlyLimitVal > 0
      ? Math.min(netBalance, yearlyLimitVal)
      : netBalance;
  } else {
    // casual — net balance, no annual cap
    availableBalance = Math.max(totalEarnedCredits - consumedEarnedDays, 0);
  }

  // Add carry-forward days from the previous cycle (0 if CF is disabled or no rollover)
  const finalBalance = availableBalance + carryForwardDays;

  const upserted = await upsertEmployeeLeaveBalance({
    employeeId,
    leaveType: type,
    usedDays: consumedEarnedDays,
    balance: finalBalance,
    cycleStart,   // store current cycle so next sync can detect rollover
    cycleEnd,
    // For rule-based types carry-forward is folded into balance directly; carry_forward_balance stays at DB default
    carryForwardBalance: null,
  });

  return {
    synced: true,
    presentDays,
    consumedEarnedDays,
    totalEarnedCredits,
    carryForwardDays,
    cycleStart,
    cycleEnd,
    balance: Number(upserted.balance || 0),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Carry-forward sync for YEARLY-LIMIT leave types (Sick, Personal, Paternity…)
// These leaves don't accrue incrementally — balance = yearly_limit − used_days.
// On cycle rollover, unused days are written to carry_forward_balance so the
// getEmployeeLeaveBalances query can add them to the new cycle's available balance.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the policy for a non-rule-based leave type for an employee.
 * Returns yearly_limit, carry_forward_enabled, renewal settings.
 */
const getNonRuleBasedPolicyForEmployee = async (employeeId, leaveType) => {
  const result = await pool.query(
    `
      SELECT
        lp.organization_id,
        lp.leave_type,
        lp.is_enabled,
        lp.yearly_limit,
        lp.carry_forward_enabled,
        e.created_at AS employee_created_at,
        COALESCE(o.leave_renewal_type, 'date_of_joining') AS leave_renewal_type
      FROM employees e
      JOIN leave_policies lp
        ON lp.organization_id = e.organization_id
      LEFT JOIN organizations o ON o.id = e.organization_id
      WHERE e.id = $1
        AND lp.leave_type = $2
      LIMIT 1
    `,
    [employeeId, leaveType]
  );
  return result.rows[0] || null;
};

/**
 * Gets the total approved leave days used by an employee for a given leave type
 * within a specific date range (cycle bounds).
 */
const getUsedDaysForCycle = async (employeeId, leaveType, cycleStart, cycleEnd) => {
  const result = await pool.query(
    `
      SELECT COALESCE(SUM(
        CASE WHEN lr.is_half_day THEN 0.5
             ELSE (LEAST(lr.end_date, $4::date) - GREATEST(lr.start_date, $3::date) + 1)::numeric
        END
      ), 0)::numeric AS used_days
      FROM leave_requests lr
      WHERE lr.employee_id = $1
        AND lr.type = $2
        AND lr.status = 'approved'
        AND lr.start_date <= $4::date
        AND lr.end_date >= $3::date
    `,
    [employeeId, leaveType, cycleStart, cycleEnd]
  );
  return Number(result.rows[0]?.used_days || 0);
};

/**
 * Syncs cycle tracking and carry-forward balance for yearly-limit leave types
 * (sick, personal, paternity, vacation, etc. — NOT earned/casual/compensation).
 *
 * On cycle rollover with carry_forward_enabled = true:
 *   - Archives the old cycle with expired_days = 0
 *   - Writes unused days into carry_forward_balance for the new cycle
 *
 * On cycle rollover with carry_forward_enabled = false:
 *   - Archives the old cycle with expired_days = unused days
 *   - Sets carry_forward_balance = 0
 *
 * @param {number} employeeId
 * @param {string} leaveType  - e.g. 'sick', 'personal', 'paternity'
 * @returns {Promise<{synced: boolean, carryForwardBalance: number}>}
 */
const syncNonRuleBasedLeaveForEmployee = async (employeeId, leaveType) => {
  const RULE_BASED = ['earned', 'casual'];
  const COMP_BASED = ['compensation', 'comp_off'];

  if (RULE_BASED.includes(leaveType) || COMP_BASED.includes(leaveType)) {
    return { synced: false, reason: 'wrong_type' };
  }

  const policy = await getNonRuleBasedPolicyForEmployee(employeeId, leaveType);
  if (!policy || !policy.is_enabled) {
    return { synced: false, reason: 'policy_missing_or_disabled' };
  }

  const renewalType = policy.leave_renewal_type || 'date_of_joining';
  const { start: cycleStart, end: cycleEnd } = getLeaveCycle(
    policy.employee_created_at,
    new Date(),
    renewalType
  );

  const todayStr = new Date().toISOString().split('T')[0];
  const existingRow = await getEmployeeLeaveBalanceByType(employeeId, leaveType);
  const carryForwardEnabled = Boolean(policy.carry_forward_enabled);

  if (existingRow && existingRow.cycle_start) {
    const storedCycleStart = new Date(existingRow.cycle_start).toISOString().split('T')[0];
    const storedCycleEnd   = existingRow.cycle_end
      ? new Date(existingRow.cycle_end).toISOString().split('T')[0]
      : null;

    if (storedCycleStart !== cycleStart) {
      // Cycle has rolled over — process carry-forward if the old cycle actually ended
      if (storedCycleEnd && storedCycleEnd < todayStr) {
        const usedInOldCycle = await getUsedDaysForCycle(
          employeeId, leaveType, storedCycleStart, storedCycleEnd
        );
        const yearlyLimit   = Number(policy.yearly_limit || 0);
        const unusedBalance = Math.max(yearlyLimit - usedInOldCycle, 0);
        const newCFBalance  = carryForwardEnabled ? unusedBalance : 0;

        await archiveExpiredLeaveBalance({
          employeeId,
          leaveType,
          cycleStart: storedCycleStart,
          cycleEnd:   storedCycleEnd,
          earnedDays: yearlyLimit,
          usedDays:   usedInOldCycle,
          expiredDays: carryForwardEnabled ? 0 : unusedBalance,
          renewalType,
        });

        await upsertEmployeeLeaveBalance({
          employeeId,
          leaveType,
          usedDays: 0,
          balance: 0,          // balance is computed live for yearly-limit types
          cycleStart,
          cycleEnd,
          carryForwardBalance: newCFBalance,
        });

        console.log(
          `[LeaveSync:NonRuleBased] Cycle rolled over for employee ${employeeId} (${leaveType}). ` +
          `Previous: ${storedCycleStart}→${storedCycleEnd}. ` +
          `CF=${carryForwardEnabled}, unused=${unusedBalance}, carryForward=${newCFBalance}`
        );

        return { synced: true, carryForwardBalance: newCFBalance };
      } else {
        // Renewal mode changed — stored cycle belongs to the old renewal mode and has not ended.
        // Do NOT archive the old DOJ/CY cycle. Instead, look up the previous cycle under
        // the NEW renewal type and backfill carry-forward from it if it has completed.
        const prevCycleRefRM = new Date(cycleStart);
        prevCycleRefRM.setUTCDate(prevCycleRefRM.getUTCDate() - 1); // one day before new cycle start
        const { start: prevCycleStartRM, end: prevCycleEndRM } = getLeaveCycle(
          policy.employee_created_at, prevCycleRefRM, renewalType
        );
        const jdStr = new Date(policy.employee_created_at).toISOString().split('T')[0];

        if (prevCycleStartRM < cycleStart && prevCycleEndRM < todayStr && jdStr <= prevCycleEndRM) {
          // A completed cycle exists under the new renewal type — backfill carry-forward.
          const usedInPrev = await getUsedDaysForCycle(employeeId, leaveType, prevCycleStartRM, prevCycleEndRM);
          const yearlyLimitV = Number(policy.yearly_limit || 0);
          const unusedV = Math.max(yearlyLimitV - usedInPrev, 0);
          const newCFBalance = carryForwardEnabled ? unusedV : 0;

          if (yearlyLimitV > 0 || usedInPrev > 0) {
            await archiveExpiredLeaveBalance({
              employeeId,
              leaveType,
              cycleStart: prevCycleStartRM,
              cycleEnd:   prevCycleEndRM,
              earnedDays: yearlyLimitV,
              usedDays:   usedInPrev,
              expiredDays: carryForwardEnabled ? 0 : unusedV,
              renewalType,
            });
          }

          await upsertEmployeeLeaveBalance({
            employeeId,
            leaveType,
            usedDays: 0,
            balance: 0,
            cycleStart,
            cycleEnd,
            carryForwardBalance: newCFBalance,
          });

          console.log(
            `[LeaveSync:NonRuleBased] Renewal mode change for employee ${employeeId} (${leaveType}). ` +
            `Backfilled ${renewalType} prev cycle: ${prevCycleStartRM}→${prevCycleEndRM}. ` +
            `CF=${carryForwardEnabled}, unused=${unusedV}, carried=${newCFBalance}`
          );
          return { synced: true, carryForwardBalance: newCFBalance };
        } else {
          // No completed cycle under the new renewal type — just reset cycle tracking.
          console.log(
            `[LeaveSync:NonRuleBased] Renewal mode change for employee ${employeeId} (${leaveType}). ` +
            `No completed ${renewalType} prev cycle to backfill. Resetting cycle tracking.`
          );
          await upsertEmployeeLeaveBalance({
            employeeId,
            leaveType,
            usedDays: 0,
            balance: 0,
            cycleStart,
            cycleEnd,
            carryForwardBalance: 0,
          });
          return { synced: true, carryForwardBalance: 0 };
        }
      }
    }
    // Same cycle — verify carry_forward_balance is not stale from a bad backfill.
    // If this is the employee's very first cycle (cycle_start == joining date), there is
    // no prior cycle to carry forward from, so carry_forward_balance must be 0.
    const joiningDateStr = new Date(policy.employee_created_at).toISOString().split('T')[0];
    const isFirstCycle = storedCycleStart === joiningDateStr;
    const storedCFBalance = Number(existingRow.carry_forward_balance || 0);
    if (isFirstCycle && storedCFBalance > 0) {
      // Stale carry-forward detected — clear it.
      console.log(
        `[LeaveSync:NonRuleBased] Clearing stale carry_forward_balance=${storedCFBalance} ` +
        `for employee ${employeeId} (${leaveType}) — first cycle, no prior cycle exists.`
      );
      await upsertEmployeeLeaveBalance({
        employeeId,
        leaveType,
        usedDays: Number(existingRow.used_days || 0),
        balance:  Number(existingRow.balance  || 0),
        cycleStart,
        cycleEnd,
        carryForwardBalance: 0,
      });
      return { synced: true, reason: 'cleared_stale_cf', carryForwardBalance: 0 };
    }
    return { synced: false, reason: 'same_cycle', carryForwardBalance: storedCFBalance };

  } else {
    // No row or null cycle_start — first time this employee is synced for this type.
    // Attempt to backfill the immediately preceding cycle.
    try {
      const prevCycleRef = new Date(cycleStart);
      prevCycleRef.setUTCDate(prevCycleRef.getUTCDate() - 1);

      const { start: prevCycleStart, end: prevCycleEnd } = getLeaveCycle(
        policy.employee_created_at,
        prevCycleRef,
        renewalType
      );

      // Guard 1: previous cycle must be earlier than the current one.
      // Guard 2: previous cycle must have actually ended (cycle_end < today).
      // Guard 3: the employee must have been active during the previous cycle
      //          (joining date on or before the last day of that cycle).
      //          For DOJ mode: joiningDate=2025-08-01, prevCycleEnd=2025-07-31 → blocked (phantom).
      //          For Calendar Year: joiningDate=2025-08-01, prevCycleEnd=2025-12-31 → allowed.
      const joiningDateStr = new Date(policy.employee_created_at).toISOString().split('T')[0];
      if (prevCycleStart < cycleStart && prevCycleEnd < todayStr && joiningDateStr <= prevCycleEnd) {
        const usedInOldCycle = await getUsedDaysForCycle(
          employeeId, leaveType, prevCycleStart, prevCycleEnd
        );
        const yearlyLimit   = Number(policy.yearly_limit || 0);
        const unusedBalance = Math.max(yearlyLimit - usedInOldCycle, 0);
        const newCFBalance  = carryForwardEnabled ? unusedBalance : 0;

        if (yearlyLimit > 0 || usedInOldCycle > 0) {
          await archiveExpiredLeaveBalance({
            employeeId,
            leaveType,
            cycleStart: prevCycleStart,
            cycleEnd:   prevCycleEnd,
            earnedDays: yearlyLimit,
            usedDays:   usedInOldCycle,
            expiredDays: carryForwardEnabled ? 0 : unusedBalance,
            renewalType,
          });
        }

        await upsertEmployeeLeaveBalance({
          employeeId,
          leaveType,
          usedDays: 0,
          balance: 0,
          cycleStart,
          cycleEnd,
          carryForwardBalance: newCFBalance,
        });

        console.log(
          `[LeaveSync:NonRuleBased] First sync backfill for employee ${employeeId} (${leaveType}). ` +
          `CF=${carryForwardEnabled}, carryForward=${newCFBalance}`
        );

        return { synced: true, carryForwardBalance: newCFBalance };
      }
    } catch (backfillErr) {
      console.warn(
        `[LeaveSync:NonRuleBased] Backfill failed for employee ${employeeId} (${leaveType}):`,
        backfillErr.message
      );
    }

    // Upsert a fresh tracking row with no carry-forward
    await upsertEmployeeLeaveBalance({
      employeeId,
      leaveType,
      usedDays: 0,
      balance: 0,
      cycleStart,
      cycleEnd,
      carryForwardBalance: 0,
    });

    return { synced: true, carryForwardBalance: 0 };
  }
};

/**
 * Returns the leave balance history (expired cycles) for all employees
 * in an organization. Used by the admin Leave History Report.
 *
 * Only returns COMPLETED cycles (cycle_end < today).
 * Filters by the organization's CURRENT leave_renewal_type so records from
 * a previously used renewal mode don't bleed into the current view.
 *
 * @param {number} organizationId
 * @param {string|null} leaveType  - Filter by leave type ('earned'|'casual'). Null = both.
 * @returns {Promise<Array>}
 */
const getEmployeeLeaveBalanceHistory = async (organizationId, leaveType = null) => {
  const params = [organizationId];
  let leaveTypeFilter = '';

  if (leaveType && ['earned', 'casual'].includes(leaveType)) {
    params.push(leaveType);
    leaveTypeFilter = `AND h.leave_type = $${params.length}`;
  } else {
    leaveTypeFilter = `AND h.leave_type IN ('earned', 'casual')`;
  }

  const result = await pool.query(
    `
      SELECT
        e.id           AS employee_id,
        e.name         AS employee_name,
        e.email,
        h.leave_type,
        h.cycle_start,
        h.cycle_end,
        h.earned_days,
        h.used_days,
        h.expired_days,
        h.renewal_type,
        h.created_at
      FROM employee_leave_balance_history h
      JOIN employees e ON e.id = h.employee_id
      JOIN organizations o ON o.id = e.organization_id
      WHERE e.organization_id = $1
        ${leaveTypeFilter}
        AND h.cycle_end < CURRENT_DATE
        AND h.renewal_type = COALESCE(o.leave_renewal_type, 'date_of_joining')
      ORDER BY e.name ASC, h.leave_type ASC, h.cycle_start DESC
    `,
    params
  );

  return result.rows;
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

  // Non-rule-based leave types that support carry-forward tracking
  const NON_RULE_BASED_CF_TYPES = ['sick', 'personal', 'paternity', 'vacation', 'unpaid'];

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

      // Sync carry-forward for yearly-limit leave types
      for (const leaveType of NON_RULE_BASED_CF_TYPES) {
        try {
          await syncNonRuleBasedLeaveForEmployee(employee.employee_id, leaveType);
        } catch (syncErr) {
          console.error(
            `Non-rule-based CF sync failed for employee ${employee.employee_id} (${leaveType}):`,
            syncErr.message
          );
        }
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
  archiveExpiredLeaveBalance,
  syncEarnedLeaveBalanceForEmployee,
  syncNonRuleBasedLeaveForEmployee,
  getOrganizationLeaveBalanceReport,
  getEmployeeLeaveBalanceHistory,
};
