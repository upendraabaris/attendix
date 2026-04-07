const pool = require("../configure/dbConfig");

const WORK_WEEK_POLICIES = {
  all_saturday_and_sunday_off: "All Saturday and Sunday Off",
  alternate_saturday_and_every_sunday_off: "Alternate Saturday and Every Sunday Off",
  second_and_fourth_saturday_and_every_sunday_off:
    "Second and Fourth Saturday and Every Sunday Off",
};

const DEFAULT_EXPIRY_DAYS = 30;

const isValidDateInput = (value) => value && !Number.isNaN(new Date(value).getTime());

const normalizeDateOnlyInput = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizePolicyName = (policyName) => {
  const value = String(policyName || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const aliases = {
    all_saturday_sunday_off: "all_saturday_and_sunday_off",
    all_saturday_and_sunday_off: "all_saturday_and_sunday_off",
    alternate_saturday_every_sunday_off: "alternate_saturday_and_every_sunday_off",
    alternate_saturday_and_every_sunday_off: "alternate_saturday_and_every_sunday_off",
    second_fourth_saturday_every_sunday_off:
      "second_and_fourth_saturday_and_every_sunday_off",
    second_and_fourth_saturday_and_every_sunday_off:
      "second_and_fourth_saturday_and_every_sunday_off",
  };

  return aliases[value] || null;
};

const validateWorkWeekPolicy = (payload = {}) => {
  const normalized = normalizePolicyName(payload.policy_name || payload.policyName);
  if (!normalized || !WORK_WEEK_POLICIES[normalized]) {
    throw new Error(
      "Invalid policy_name. Allowed values are All Saturday and Sunday Off, Alternate Saturday and Every Sunday Off, Second and Fourth Saturday and Every Sunday Off"
    );
  }

  const policyStartDate = normalizeDateOnlyInput(
    payload.policy_start_date || payload.policyStartDate || null
  );
  if (
    normalized === "alternate_saturday_and_every_sunday_off" &&
    (!policyStartDate || !isValidDateInput(policyStartDate))
  ) {
    throw new Error("policy_start_date is required for Alternate Saturday and Every Sunday Off");
  }

  if (policyStartDate && !isValidDateInput(policyStartDate)) {
    throw new Error("policy_start_date must be a valid date");
  }

  return {
    policy_name: normalized,
    policy_label: WORK_WEEK_POLICIES[normalized],
    policy_start_date: policyStartDate,
  };
};

const validateHolidayInput = (payload = {}) => {
  const holidayName = String(payload.holiday_name || payload.holidayName || "").trim();
  const holidayDate = normalizeDateOnlyInput(payload.holiday_date || payload.holidayDate || "");
  const description =
    payload.description === undefined || payload.description === null
      ? null
      : String(payload.description).trim();

  if (!holidayName) {
    throw new Error("holiday_name is required");
  }

  if (!holidayDate || Number.isNaN(new Date(holidayDate).getTime())) {
    throw new Error("Valid holiday_date is required");
  }

  return {
    holiday_name: holidayName,
    holiday_date: holidayDate,
    description: description || null,
  };
};

const getWorkWeekPolicyByOrganization = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT id, organization_id, policy_name, created_at, updated_at
           , policy_start_date
      FROM work_week_policies
      WHERE organization_id = $1
      LIMIT 1
    `,
    [organizationId]
  );

  const row = result.rows[0] || null;
  if (!row) return null;

  return {
    ...row,
    policy_label: WORK_WEEK_POLICIES[row.policy_name] || row.policy_name,
  };
};

const upsertWorkWeekPolicy = async (organizationId, payload) => {
  const data = validateWorkWeekPolicy(payload);

  const result = await pool.query(
    `
      INSERT INTO work_week_policies (organization_id, policy_name, policy_start_date, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (organization_id)
      DO UPDATE SET
        policy_name = EXCLUDED.policy_name,
        policy_start_date = EXCLUDED.policy_start_date,
        updated_at = NOW()
      RETURNING id, organization_id, policy_name, policy_start_date, created_at, updated_at
    `,
    [organizationId, data.policy_name, data.policy_start_date]
  );

  return {
    ...result.rows[0],
    policy_label: WORK_WEEK_POLICIES[data.policy_name],
  };
};

const updateWorkWeekPolicy = async (organizationId, policyId, payload) => {
  const existing = await pool.query(
    `
      SELECT id
      FROM work_week_policies
      WHERE id = $1
        AND organization_id = $2
      LIMIT 1
    `,
    [policyId, organizationId]
  );

  if (!existing.rows.length) {
    return null;
  }

  const data = validateWorkWeekPolicy(payload);
  const result = await pool.query(
    `
      UPDATE work_week_policies
      SET policy_name = $1,
          policy_start_date = $2,
          updated_at = NOW()
      WHERE id = $3
        AND organization_id = $4
      RETURNING id, organization_id, policy_name, policy_start_date, created_at, updated_at
    `,
    [data.policy_name, data.policy_start_date, policyId, organizationId]
  );

  return {
    ...result.rows[0],
    policy_label: WORK_WEEK_POLICIES[data.policy_name],
  };
};

const createHoliday = async (organizationId, payload) => {
  const data = validateHolidayInput(payload);
  const result = await pool.query(
    `
      INSERT INTO holidays (organization_id, holiday_name, holiday_date, description, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, organization_id, holiday_name, holiday_date, description, created_at, updated_at
    `,
    [organizationId, data.holiday_name, data.holiday_date, data.description]
  );
  return result.rows[0];
};

const listHolidays = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT id, organization_id, holiday_name, holiday_date, description, created_at, updated_at
      FROM holidays
      WHERE organization_id = $1
      ORDER BY holiday_date ASC, id ASC
    `,
    [organizationId]
  );
  return result.rows;
};

const updateHoliday = async (organizationId, holidayId, payload) => {
  const existing = await pool.query(
    `
      SELECT id
      FROM holidays
      WHERE id = $1
        AND organization_id = $2
      LIMIT 1
    `,
    [holidayId, organizationId]
  );

  if (!existing.rows.length) {
    return null;
  }

  const data = validateHolidayInput(payload);
  const result = await pool.query(
    `
      UPDATE holidays
      SET holiday_name = $1,
          holiday_date = $2,
          description = $3,
          updated_at = NOW()
      WHERE id = $4
        AND organization_id = $5
      RETURNING id, organization_id, holiday_name, holiday_date, description, created_at, updated_at
    `,
    [data.holiday_name, data.holiday_date, data.description, holidayId, organizationId]
  );
  return result.rows[0];
};

const deleteHoliday = async (organizationId, holidayId) => {
  const result = await pool.query(
    `
      DELETE FROM holidays
      WHERE id = $1
        AND organization_id = $2
      RETURNING id
    `,
    [holidayId, organizationId]
  );
  return result.rows[0] || null;
};

const getEmployeeContext = async (employeeId) => {
  const result = await pool.query(
    `
      SELECT id, organization_id, name
      FROM employees
      WHERE id = $1
      LIMIT 1
    `,
    [employeeId]
  );
  return result.rows[0] || null;
};

const getHolidayForDate = async (organizationId, workDate) => {
  const result = await pool.query(
    `
      SELECT id, holiday_name, holiday_date, description
      FROM holidays
      WHERE organization_id = $1
        AND holiday_date = $2::date
      LIMIT 1
    `,
    [organizationId, workDate]
  );
  return result.rows[0] || null;
};

const hasCompletedAttendanceForDate = async (employeeId, workDate) => {
  const result = await pool.query(
    `
      SELECT *
      FROM get_particular_attendance($1, $2::date, $2::date)
    `,
    [employeeId, workDate]
  );

  return result.rows.some((row) => row.clock_in && row.clock_out);
};

const getSaturdayOccurrence = (dateValue) => Math.ceil(dateValue.getDate() / 7);

const toDateOnly = (value) => new Date(`${value}T00:00:00`);

const isWeeklyOffAsPerPolicy = (workDate, policyName, policyStartDate = null) => {
  const dateValue = toDateOnly(workDate);
  const day = dateValue.getDay();

  if (day === 0) {
    return true;
  }

  if (day !== 6 || !policyName) {
    return false;
  }

  const occurrence = getSaturdayOccurrence(dateValue);

  if (policyName === "all_saturday_and_sunday_off") {
    return true;
  }

  if (policyName === "alternate_saturday_and_every_sunday_off") {
    if (!policyStartDate) {
      return occurrence % 2 === 1;
    }

    const startDate = toDateOnly(policyStartDate);
    if (startDate.getDay() !== 6 || dateValue < startDate) {
      return false;
    }

    const diffDays = Math.floor((dateValue - startDate) / (1000 * 60 * 60 * 24));
    return diffDays % 14 === 0;
  }

  if (policyName === "second_and_fourth_saturday_and_every_sunday_off") {
    return occurrence === 2 || occurrence === 4;
  }

  return false;
};

const buildExpiryDate = (workDate, expiryDays = DEFAULT_EXPIRY_DAYS) => {
  const dateValue = new Date(`${workDate}T00:00:00`);
  dateValue.setDate(dateValue.getDate() + Number(expiryDays || DEFAULT_EXPIRY_DAYS));
  return dateValue.toISOString().split("T")[0];
};

const evaluateCompOffEligibility = async ({ employeeId, organizationId, workDate }) => {
  const employee = await getEmployeeContext(employeeId);
  if (!employee) {
    throw new Error("Employee not found");
  }

  if (organizationId && Number(employee.organization_id) !== Number(organizationId)) {
    throw new Error("Employee does not belong to the current organization");
  }

  const attendanceComplete = await hasCompletedAttendanceForDate(employeeId, workDate);
  if (!attendanceComplete) {
    return {
      eligible: false,
      reason: null,
      message: "Comp off can be earned only after completed attendance for the work date",
      employee,
    };
  }

  const holiday = await getHolidayForDate(employee.organization_id, workDate);
  if (holiday) {
    return {
      eligible: true,
      reason: "holiday",
      message: `Eligible because ${workDate} is configured as a holiday`,
      employee,
      holiday,
    };
  }

  const policy = await getWorkWeekPolicyByOrganization(employee.organization_id);
  if (isWeeklyOffAsPerPolicy(workDate, policy?.policy_name, policy?.policy_start_date)) {
    return {
      eligible: true,
      reason: "weekly_off",
      message: `Eligible because ${workDate} is a weekly off as per the selected work week policy`,
      employee,
      policy,
    };
  }

  return {
    eligible: false,
    reason: null,
    message: "Selected work date is neither a holiday nor a weekly off",
    employee,
    policy,
  };
};

const earnCompOff = async ({
  employeeId,
  organizationId,
  workDate,
  expiryDays = DEFAULT_EXPIRY_DAYS,
}) => {
  if (!workDate || Number.isNaN(new Date(workDate).getTime())) {
    throw new Error("Valid work_date is required");
  }

  const evaluation = await evaluateCompOffEligibility({
    employeeId,
    organizationId,
    workDate,
  });

  if (!evaluation.eligible) {
    return {
      created: false,
      duplicate: false,
      ...evaluation,
    };
  }

  const result = await pool.query(
    `
      INSERT INTO compensation_earned (
        employee_id,
        work_date,
        comp_leave_used,
        reason,
        expiry_date,
        created_at
      )
      VALUES ($1, $2::date, false, $3, $4::date, NOW())
      ON CONFLICT (employee_id, work_date)
      DO NOTHING
      RETURNING *
    `,
    [employeeId, workDate, evaluation.reason, buildExpiryDate(workDate, expiryDays)]
  );

  if (!result.rows.length) {
    const existing = await pool.query(
      `
        SELECT *
        FROM compensation_earned
        WHERE employee_id = $1
          AND work_date = $2::date
        LIMIT 1
      `,
      [employeeId, workDate]
    );

    return {
      created: false,
      duplicate: true,
      ...evaluation,
      data: existing.rows[0] || null,
      message: "Comp off already exists for this employee and work date",
    };
  }

  return {
    created: true,
    duplicate: false,
    ...evaluation,
    data: result.rows[0],
    message: "Comp off earned successfully",
  };
};

const getCompOffBalance = async (employeeId, organizationId) => {
  const employee = await getEmployeeContext(employeeId);
  if (!employee) {
    throw new Error("Employee not found");
  }

  if (organizationId && Number(employee.organization_id) !== Number(organizationId)) {
    throw new Error("Employee does not belong to the current organization");
  }

  const result = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE comp_leave_used = false
            AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
        )::int AS available_balance,
        COUNT(*) FILTER (WHERE comp_leave_used = true)::int AS used_count,
        COUNT(*) FILTER (
          WHERE comp_leave_used = false
            AND expiry_date IS NOT NULL
            AND expiry_date < CURRENT_DATE
        )::int AS expired_count,
        COUNT(*)::int AS total_earned
      FROM compensation_earned
      WHERE employee_id = $1
    `,
    [employeeId]
  );

  return {
    employee_id: employeeId,
    employee_name: employee.name,
    ...result.rows[0],
  };
};

const getCompOffHistory = async (employeeId, organizationId) => {
  const employee = await getEmployeeContext(employeeId);
  if (!employee) {
    throw new Error("Employee not found");
  }

  if (organizationId && Number(employee.organization_id) !== Number(organizationId)) {
    throw new Error("Employee does not belong to the current organization");
  }

  const result = await pool.query(
    `
      SELECT
        ce.id,
        ce.employee_id,
        e.name AS employee_name,
        ce.work_date,
        ce.reason,
        ce.comp_leave_used,
        ce.expiry_date,
        ce.created_at,
        CASE
          WHEN ce.comp_leave_used THEN 'used'
          WHEN ce.expiry_date IS NOT NULL AND ce.expiry_date < CURRENT_DATE THEN 'expired'
          ELSE 'available'
        END AS status
      FROM compensation_earned ce
      JOIN employees e
        ON e.id = ce.employee_id
      WHERE ce.employee_id = $1
        AND e.organization_id = $2
      ORDER BY ce.work_date DESC, ce.id DESC
    `,
    [employeeId, organizationId]
  );

  return result.rows;
};

const useCompOff = async ({ compOffId, employeeId, organizationId }) => {
  const result = await pool.query(
    `
      UPDATE compensation_earned ce
      SET comp_leave_used = true
      FROM employees e
      WHERE ce.id = $1
        AND ce.employee_id = e.id
        AND e.organization_id = $3
        AND ($2::int IS NULL OR ce.employee_id = $2::int)
        AND ce.comp_leave_used = false
      RETURNING ce.*
    `,
    [compOffId, employeeId || null, organizationId]
  );

  return result.rows[0] || null;
};

module.exports = {
  WORK_WEEK_POLICIES,
  DEFAULT_EXPIRY_DAYS,
  getWorkWeekPolicyByOrganization,
  upsertWorkWeekPolicy,
  updateWorkWeekPolicy,
  createHoliday,
  listHolidays,
  updateHoliday,
  deleteHoliday,
  earnCompOff,
  getCompOffBalance,
  getCompOffHistory,
  useCompOff,
};
