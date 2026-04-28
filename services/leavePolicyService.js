const pool = require("../configure/dbConfig");
const { syncEarnedLeaveBalanceForEmployee } = require("./leaveBalanceService");

const SUPPORTED_LEAVE_TYPES = ["sick", "personal", "other", "earned", "casual", "compensation", "paternity", "vacation"];
const COMP_OFF_LEAVE_TYPES = ["compensation", "comp_off"];
const RULE_BASED_LEAVE_TYPES = ["earned", "casual"];
const LEAVE_BALANCE_TYPE_ALIASES = {
  vacation: "earned",
};

const getBalanceLeaveType = (leaveType) => LEAVE_BALANCE_TYPE_ALIASES[leaveType] || leaveType;
const getLeaveTypesForBalance = (leaveType) => {
  const balanceLeaveType = getBalanceLeaveType(leaveType);
  return balanceLeaveType === "earned" ? ["earned", "vacation"] : [leaveType];
};

const orderedPolicies = (rows = []) => {
  const order = ["sick", "vacation", "personal", "other", "earned", "paternity"];
  return rows.sort(
    (a, b) => order.indexOf(a.leave_type) - order.indexOf(b.leave_type)
  );
};

const validatePolicyInput = (payload = {}, isUpdate = false) => {
  const normalized = {
    leave_type: payload.leave_type,
    yearly_limit: payload.yearly_limit,
    is_enabled: payload.is_enabled,
    earned_days_required: payload.earned_days_required,
    earned_leave_award: payload.earned_leave_award,
    document_days_required: payload.document_days_required,
    max_consecutive_days: payload.max_consecutive_days,
    expire_limit: payload.expire_limit,
  };

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "leave_type")) {
    if (!normalized.leave_type || !SUPPORTED_LEAVE_TYPES.includes(normalized.leave_type)) {
      throw new Error("Invalid leave_type. Allowed: sick, personal, other, earned, casual, compensation", "paternity", "vacation");
    }
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "yearly_limit")) {
    const limit = Number(normalized.yearly_limit);
    if (Number.isNaN(limit) || limit < 0) {
      throw new Error("yearly_limit must be a non-negative number");
    }
    normalized.yearly_limit = limit;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "is_enabled")) {
    normalized.is_enabled =
      typeof normalized.is_enabled === "boolean" ? normalized.is_enabled : true;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "max_consecutive_days")) {
    if (
      normalized.max_consecutive_days !== undefined &&
      normalized.max_consecutive_days !== null
    ) {
      const maxDays = Number(normalized.max_consecutive_days);
      if (Number.isNaN(maxDays) || maxDays <= 0) {
        throw new Error("max_consecutive_days must be a positive number");
      }
      normalized.max_consecutive_days = maxDays;
    }
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(payload, "expire_limit")) {
    if (normalized.expire_limit !== undefined && normalized.expire_limit !== null) {
      const expireLimit = Number(normalized.expire_limit);
      if (Number.isNaN(expireLimit) || expireLimit <= 0) {
        throw new Error("expire_limit must be a positive number");
      }
      normalized.expire_limit = expireLimit;
    }
  }

  const leaveType = normalized.leave_type;
  if (leaveType === "earned" || leaveType === "casual") {
    if (
      normalized.earned_days_required !== undefined &&
      normalized.earned_days_required !== null
    ) {
      const days = Number(normalized.earned_days_required);
      if (Number.isNaN(days) || days <= 0) {
        throw new Error("earned_days_required must be a positive number");
      }
      normalized.earned_days_required = days;
    }

    if (
      normalized.earned_leave_award !== undefined &&
      normalized.earned_leave_award !== null
    ) {
      const award = Number(normalized.earned_leave_award);
      if (Number.isNaN(award) || award <= 0) {
        throw new Error("earned_leave_award must be a positive number");
      }
      normalized.earned_leave_award = award;
    }
  } else {
    normalized.earned_days_required = null;
    normalized.earned_leave_award = null;
  }

  if (leaveType !== "casual") {
    normalized.max_consecutive_days = null;
  }

  if (leaveType !== "compensation") {
    normalized.expire_limit = null;
  }

  return normalized;
};

const upsertLeavePolicy = async (organizationId, payload) => {
  console.log("Upserting leave policy with payload:", payload); // Debug log
  const data = validatePolicyInput(payload);
  const result = await pool.query(
    `
      INSERT INTO leave_policies (
        organization_id, leave_type, yearly_limit, is_enabled, earned_days_required, earned_leave_award, document_days_required, max_consecutive_days, expire_limit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (organization_id, leave_type)
      DO UPDATE SET
        yearly_limit = EXCLUDED.yearly_limit,
        is_enabled = EXCLUDED.is_enabled,
        earned_days_required = EXCLUDED.earned_days_required,
        earned_leave_award = EXCLUDED.earned_leave_award,
        document_days_required = EXCLUDED.document_days_required,
        max_consecutive_days = EXCLUDED.max_consecutive_days,
        expire_limit = EXCLUDED.expire_limit
      RETURNING *
    `,
    [
      organizationId,
      data.leave_type,
      data.yearly_limit,
      data.is_enabled,
      data.earned_days_required ?? null,
      data.earned_leave_award ?? null,
      data.document_days_required ?? null,
      data.max_consecutive_days ?? null,
      data.expire_limit ?? null,
    ]
  );

  return result.rows[0];
};

// const getLeavePoliciesByOrganization = async (organizationId) => {
//   const result = await pool.query(
//     `
//       SELECT
//         id,
//         organization_id,
//         leave_type,
//         yearly_limit,
//         is_enabled,
//         earned_days_required,
//         earned_leave_award,
//         created_at
//       FROM leave_policies
//       WHERE organization_id = $1
//     `,
//     [organizationId]
//   );

//   const rowMap = result.rows.reduce((acc, row) => {
//     acc[row.leave_type] = row;
//     return acc;
//   }, {});

//   const merged = SUPPORTED_LEAVE_TYPES.map((leaveType) => {
//     const existing = rowMap[leaveType];
//     if (existing) {
//       return existing;
//     }
//     return {
//       id: null,
//       organization_id: Number(organizationId),
//       leave_type: leaveType,
//       yearly_limit: 0,
//       is_enabled: false,
//       earned_days_required: leaveType === "earned" ? 20 : null,
//       earned_leave_award: leaveType === "earned" ? 1 : null,
//       created_at: null,
//     };
//   });

//   return orderedPolicies(merged);
// };

const getLeavePoliciesByOrganization = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT
        id,
        organization_id,
        leave_type,
        yearly_limit,
        is_enabled,
        earned_days_required,
        earned_leave_award,
        document_days_required,
        max_consecutive_days,
        expire_limit,
        created_at
      FROM leave_policies
      WHERE organization_id = $1
      ORDER BY id
    `,
    [organizationId]
  );

  return result.rows;
};

const updateLeavePolicy = async (organizationId, policyId, payload) => {
  const existingResult = await pool.query(
    `
      SELECT *
      FROM leave_policies
      WHERE id = $1
        AND organization_id = $2
      LIMIT 1
    `,
    [policyId, organizationId]
  );

  if (!existingResult.rows.length) {
    return null;
  }

  const existing = existingResult.rows[0];
  const incoming = {
    ...existing,
    ...payload,
    leave_type: existing.leave_type,
  };
  const data = validatePolicyInput(incoming, true);

  const updated = await pool.query(
    `
      UPDATE leave_policies
      SET
        yearly_limit = $1,
        is_enabled = $2,
        earned_days_required = $3,
        earned_leave_award = $4,
        document_days_required = $7,
        max_consecutive_days = $8,
        expire_limit = $9
      WHERE id = $5
        AND organization_id = $6
      RETURNING *
    `,
    [
      data.yearly_limit,
      data.is_enabled,
      data.earned_days_required ?? null,
      data.earned_leave_award ?? null,
      policyId,
      organizationId,
      data.document_days_required ?? null,
      data.max_consecutive_days ?? null,
      data.expire_limit ?? null,
    ]
  );

  return updated.rows[0];
};

const validateLeaveRequestAgainstPolicy = async ({
  employeeId,
  leaveType,
  startDate,
  endDate,
}) => {
  const balanceLeaveType = getBalanceLeaveType(leaveType);
  const leaveTypesForBalance = getLeaveTypesForBalance(leaveType);
  const policyResult = await pool.query(
    `
      SELECT
        lp.*,
        e.organization_id
      FROM employees e
      LEFT JOIN leave_policies lp
        ON lp.organization_id = e.organization_id
       AND lp.leave_type = $2
      WHERE e.id = $1
      LIMIT 1
    `,
    [employeeId, balanceLeaveType]
  );

  if (!policyResult.rows.length) {
    throw new Error("Employee not found");
  }

  const policy = policyResult.rows[0];
  if (!policy.id) {
    throw new Error(`Leave policy is not configured for type "${balanceLeaveType}"`);
  }

  if (!policy.is_enabled) {
    throw new Error(`Leave type "${balanceLeaveType}" is currently disabled`);
  }

  const requestedDays =
    Math.floor(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) /
      (1000 * 60 * 60 * 24)
    ) + 1;

  const pendingResult = await pool.query(
    `
      SELECT COALESCE(SUM(lr.end_date - lr.start_date + 1), 0)::int AS pending_days
      FROM leave_requests lr
      WHERE lr.employee_id = $1
        AND lr.type = ANY($2::text[])
        AND lr.status = 'pending'
    `,
    [employeeId, leaveTypesForBalance]
  );

  const pendingDays = Number(pendingResult.rows[0]?.pending_days || 0);

  if (
    policy.max_consecutive_days &&
    requestedDays > Number(policy.max_consecutive_days)
  ) {
    throw new Error(
      `Maximum ${policy.max_consecutive_days} consecutive day(s) allowed for type "${balanceLeaveType}"`
    );
  }

  if (COMP_OFF_LEAVE_TYPES.includes(balanceLeaveType)) {
    const balanceResult = await pool.query(
      `
        SELECT COUNT(*) FILTER (
          WHERE comp_leave_used = false
            AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        )::int AS available_balance
        FROM compensation_earned
        WHERE employee_id = $1
      `,
      [employeeId]
    );

    const availableBalance = Number(balanceResult.rows[0]?.available_balance || 0);
    const remainingBalance = availableBalance - pendingDays;

    if (remainingBalance < requestedDays) {
      throw new Error(
        `Insufficient ${leaveType} leave balance. Available: ${Math.max(
          remainingBalance,
          0
        )} day(s), Requested: ${requestedDays} day(s)`
      );
    }

    return;
  }

  if (RULE_BASED_LEAVE_TYPES.includes(balanceLeaveType)) {
    const sync = await syncEarnedLeaveBalanceForEmployee(employeeId, balanceLeaveType);
    const remainingBalance = Number(sync.balance || 0) - pendingDays;

    if (remainingBalance < requestedDays) {
      throw new Error(
        `Insufficient ${balanceLeaveType} leave balance. Available: ${Math.max(
          remainingBalance,
          0
        )} day(s), Pending: ${pendingDays} day(s), Requested: ${requestedDays} day(s)`
      );
    }
    return;
  }

  const year = new Date(startDate).getUTCFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const usageResult = await pool.query(
    `
      SELECT COALESCE(SUM(
        LEAST(lr.end_date, $4::date) - GREATEST(lr.start_date, $3::date) + 1
      ), 0)::numeric AS used_days
      FROM leave_requests lr
      WHERE lr.employee_id = $1
        AND lr.type = ANY($2::text[])
        AND lr.status = 'approved'
        AND lr.start_date <= $4::date
        AND lr.end_date >= $3::date
    `,
    [employeeId, leaveTypesForBalance, yearStart, yearEnd]
  );

  const usedDays = Number(usageResult.rows[0]?.used_days || 0);
  const allowed = Number(policy.yearly_limit || 0);
  if (usedDays + pendingDays + requestedDays > allowed) {
    throw new Error(`Yearly leave limit exceeded for type "${balanceLeaveType}"`);
  }
};

module.exports = {
  SUPPORTED_LEAVE_TYPES,
  upsertLeavePolicy,
  getLeavePoliciesByOrganization,
  updateLeavePolicy,
  validateLeaveRequestAgainstPolicy,
};
