const pool = require("../configure/dbConfig");

// Reward points ledger. The ledger is the source of truth; every award is
// idempotent at the database level via the partial unique indexes created by
// create_reward_tables.js. See REWARD_POINTS_MODULE.md sections 4.3-4.4 and 6.5.
//
// IMPORTANT — timezone: every IST calendar date and minutes-of-day value is
// derived in SQL with `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'`, matching
// the existing convention in attendanceCtrl. This is deliberate: node-postgres
// parses `timestamp without time zone` using the Node host's local timezone, so
// shifting by +330 minutes in JavaScript would give different answers depending
// on the server's TZ. SQL-side conversion is host independent.

const LEAVE_RULE = "leave_early_application";
const PUNCTUALITY_RULE = "punctuality";

// Admins never earn reward points. Exact, case-insensitive role match.
const isAdminRole = (role) => String(role || "").trim().toLowerCase() === "admin";

const isActiveEmployee = (status) =>
  String(status || "active").trim().toLowerCase() === "active";

const skipped = (reason) => ({
  created: false,
  duplicate: false,
  skipped: true,
  reason,
  data: null,
});

/**
 * Loads the organization's reward settings with start_date as a plain
 * YYYY-MM-DD string, and confirms the system is usable.
 * Returns null when rewards must not be generated at all.
 */
const loadActiveSettings = async (organizationId) => {
  if (!organizationId) return null;

  const result = await pool.query(
    `
      SELECT is_enabled,
             start_date::text AS start_date,
             leave_early_enabled,
             leave_early_days_before,
             leave_early_points,
             punctuality_enabled
      FROM reward_settings
      WHERE organization_id = $1
      LIMIT 1
    `,
    [organizationId]
  );

  const settings = result.rows[0];
  if (!settings || !settings.is_enabled) return null;
  // Enabled without a start date cannot be evaluated; validation prevents this.
  if (!settings.start_date) return null;

  return settings;
};

/**
 * The single idempotent insert used by both rules.
 * A duplicate is a normal outcome and never throws.
 */
const insertLedgerEntry = async ({
  organizationId,
  employeeId,
  ruleType,
  points,
  awardDate,
  leaveRequestId = null,
  workDate = null,
  meta = null,
}) => {
  const result = await pool.query(
    `
      INSERT INTO employee_reward_points (
        organization_id, employee_id, rule_type, points, award_date,
        leave_request_id, work_date, status, meta, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::date, $6, $7::date, 'active', $8::jsonb, NOW(), NOW())
      ON CONFLICT DO NOTHING
      RETURNING id, organization_id, employee_id, rule_type, points,
                award_date::text AS award_date, leave_request_id,
                work_date::text AS work_date, status, meta, created_at
    `,
    [
      organizationId,
      employeeId,
      ruleType,
      points,
      awardDate,
      leaveRequestId,
      workDate,
      meta ? JSON.stringify(meta) : null,
    ]
  );

  if (!result.rows.length) {
    return {
      created: false,
      duplicate: true,
      skipped: false,
      reason: "already_awarded",
      data: null,
    };
  }

  return {
    created: true,
    duplicate: false,
    skipped: false,
    reason: null,
    data: result.rows[0],
  };
};

/**
 * Awards the leave early-application reward for a leave request that has just
 * been APPROVED. Never call this on creation or rejection.
 *
 * All dates are resolved in SQL:
 *   - applied_on  = created_at  in IST
 *   - approved_on = updated_at  in IST (set by update_leave_request_status)
 *   - days_before = start_date - applied_on
 *
 * @param {number} leaveRequestId
 */
const awardLeaveEarlyApplication = async ({ leaveRequestId }) => {
  if (!leaveRequestId) return skipped("missing_leave_request_id");

  const context = await pool.query(
    `
      SELECT lr.employee_id,
             lr.start_date::text AS leave_start_date,
             DATE(lr.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS applied_on,
             DATE(COALESCE(lr.updated_at, lr.created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS approved_on,
             (lr.start_date
                - DATE(lr.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'))::int AS days_before,
             lr.status,
             e.organization_id,
             e.role,
             COALESCE(e.status, 'active') AS employee_status
      FROM leave_requests lr
      JOIN employees e ON e.id = lr.employee_id
      WHERE lr.id = $1
      LIMIT 1
    `,
    [leaveRequestId]
  );

  const row = context.rows[0];
  if (!row) return skipped("leave_request_not_found");
  // Defensive: only approved leave earns points.
  if (String(row.status).toLowerCase() !== "approved") return skipped("leave_not_approved");
  if (isAdminRole(row.role)) return skipped("admin_not_eligible");
  if (!isActiveEmployee(row.employee_status)) return skipped("employee_inactive");

  const settings = await loadActiveSettings(row.organization_id);
  if (!settings) return skipped("reward_system_disabled");
  if (!settings.leave_early_enabled) return skipped("leave_early_reward_disabled");

  const configuredDaysBefore = Number(settings.leave_early_days_before);
  const configuredPoints = Number(settings.leave_early_points);
  if (!Number.isFinite(configuredDaysBefore) || !Number.isFinite(configuredPoints)) {
    return skipped("leave_early_reward_not_configured");
  }

  // award_date is the approval date in IST.
  if (!row.approved_on) return skipped("invalid_approval_timestamp");
  if (row.approved_on < settings.start_date) return skipped("before_reward_start_date");

  const daysBefore = Number(row.days_before);
  if (!Number.isFinite(daysBefore)) return skipped("invalid_leave_dates");

  // "Exactly N days before" qualifies, and so does anything earlier.
  if (daysBefore < configuredDaysBefore) return skipped("applied_too_late");

  return insertLedgerEntry({
    organizationId: row.organization_id,
    employeeId: row.employee_id,
    ruleType: LEAVE_RULE,
    points: configuredPoints,
    awardDate: row.approved_on,
    leaveRequestId,
    workDate: null,
    meta: {
      days_before: daysBefore,
      configured_days_before: configuredDaysBefore,
      applied_on: row.applied_on,
      leave_start_date: row.leave_start_date,
      approved_on: row.approved_on,
    },
  });
};

const formatMinutesOfDay = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Awards the punctuality reward for an employee's FIRST clock-in of an IST day.
 *
 * The punch is identified by its attendance row id so that the IST work date
 * and minutes-of-day can be derived in SQL.
 *
 * @param {number} employeeId
 * @param {number} attendanceId - id returned by clock_in()
 */
const awardPunctuality = async ({ employeeId, attendanceId }) => {
  if (!employeeId) return skipped("missing_employee_id");
  if (!attendanceId) return skipped("missing_attendance_id");

  const punchResult = await pool.query(
    `
      SELECT a.employee_id,
             a.type,
             DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS work_date,
             (EXTRACT(HOUR   FROM (a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')) * 60
            + EXTRACT(MINUTE FROM (a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')))::int AS actual_minutes
      FROM attendance a
      WHERE a.id = $1
      LIMIT 1
    `,
    [attendanceId]
  );

  const punch = punchResult.rows[0];
  if (!punch) return skipped("attendance_row_not_found");
  if (String(punch.type).toLowerCase() !== "in") return skipped("not_an_in_punch");
  if (Number(punch.employee_id) !== Number(employeeId)) return skipped("attendance_employee_mismatch");
  if (!punch.work_date) return skipped("invalid_punch_timestamp");

  const employeeResult = await pool.query(
    `
      SELECT e.organization_id,
             e.role,
             COALESCE(e.status, 'active') AS status,
             (EXTRACT(HOUR FROM e.expected_clock_in_time) * 60
            + EXTRACT(MINUTE FROM e.expected_clock_in_time))::int AS expected_minutes
      FROM employees e
      WHERE e.id = $1
      LIMIT 1
    `,
    [employeeId]
  );

  const employee = employeeResult.rows[0];
  if (!employee) return skipped("employee_not_found");
  if (isAdminRole(employee.role)) return skipped("admin_not_eligible");
  if (!isActiveEmployee(employee.status)) return skipped("employee_inactive");
  if (employee.expected_minutes === null || employee.expected_minutes === undefined) {
    return skipped("expected_clock_in_time_not_set");
  }

  const settings = await loadActiveSettings(employee.organization_id);
  if (!settings) return skipped("reward_system_disabled");
  if (!settings.punctuality_enabled) return skipped("punctuality_reward_disabled");
  if (punch.work_date < settings.start_date) return skipped("before_reward_start_date");

  // Only the first IN punch of the IST day is evaluated.
  const earlierPunches = await pool.query(
    `
      SELECT COUNT(*)::int AS earlier_count
      FROM attendance a
      WHERE a.employee_id = $1
        AND a.type = 'in'
        AND DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $2::date
        AND a.id <> $3
        AND (a.timestamp < (SELECT b.timestamp FROM attendance b WHERE b.id = $3)
             OR (a.timestamp = (SELECT b.timestamp FROM attendance b WHERE b.id = $3) AND a.id < $3))
    `,
    [employeeId, punch.work_date, attendanceId]
  );

  if (Number(earlierPunches.rows[0]?.earlier_count || 0) > 0) {
    return skipped("not_first_punch_of_day");
  }

  const expectedMinutes = Number(employee.expected_minutes);
  const actualMinutes = Number(punch.actual_minutes);
  if (!Number.isFinite(expectedMinutes) || !Number.isFinite(actualMinutes)) {
    return skipped("invalid_time_values");
  }

  // Early or exactly on time both count as zero minutes late, matching the
  // existing late-clock-in banner which treats diff <= 0 as on time.
  const minutesLate = Math.max(0, actualMinutes - expectedMinutes);

  const slabResult = await pool.query(
    `
      SELECT id, max_minutes_late, points
      FROM reward_punctuality_slabs
      WHERE organization_id = $1
        AND max_minutes_late >= $2
      ORDER BY max_minutes_late ASC
      LIMIT 1
    `,
    [employee.organization_id, minutesLate]
  );

  const slab = slabResult.rows[0];
  if (!slab) return skipped("no_matching_slab");

  return insertLedgerEntry({
    organizationId: employee.organization_id,
    employeeId,
    ruleType: PUNCTUALITY_RULE,
    points: Number(slab.points),
    awardDate: punch.work_date,
    leaveRequestId: null,
    workDate: punch.work_date,
    meta: {
      minutes_late: minutesLate,
      expected_time: formatMinutesOfDay(expectedMinutes),
      actual_time: formatMinutesOfDay(actualMinutes),
      slab_id: slab.id,
      slab_max_minutes_late: Number(slab.max_minutes_late),
    },
  });
};

/**
 * Marks every reward tied to a leave request as reversed.
 * Not used in v1 (rewards are only granted on approval, and there is no leave
 * cancellation flow), but kept so a future reversal path needs no schema change.
 */
const reverseAwardsForLeaveRequest = async (leaveRequestId) => {
  if (!leaveRequestId) return { reversed: 0 };
  const result = await pool.query(
    `
      UPDATE employee_reward_points
      SET status = 'reversed', updated_at = NOW()
      WHERE leave_request_id = $1
        AND status = 'active'
      RETURNING id
    `,
    [leaveRequestId]
  );
  return { reversed: result.rowCount };
};

/**
 * ONE-TIME (repeatable, idempotent) historical backfill.
 *
 * Walks existing attendance and approved-leave activity from the reward system
 * start date onward and stores any missing ledger rows, so historical activity
 * earns points instead of relying on a live recalculation at ranking time.
 *
 * It deliberately reuses awardLeaveEarlyApplication / awardPunctuality rather
 * than reimplementing the rules, which guarantees:
 *   - identical eligibility semantics to the live hooks,
 *   - identical idempotency (ON CONFLICT DO NOTHING on the same natural keys),
 *   - no possibility of the backfill and the live flow diverging.
 *
 * Existing ledger rows are never updated or deleted — a duplicate is simply a
 * no-op, so running this repeatedly is safe.
 *
 * LIMITATION (documented deliberately): reward_settings and
 * reward_punctuality_slabs store only the CURRENT configuration — there are no
 * effective-dated versions and no settings history anywhere in the schema — so
 * historical activity is scored with the settings in force AT BACKFILL TIME.
 * Past settings cannot be reconstructed and are not guessed.
 *
 * @param {number} organizationId
 * @param {string} [from] YYYY-MM-DD. Clamped to the reward start date.
 * @param {string} [to]   YYYY-MM-DD. Defaults to today (IST).
 */
const backfillRewardPoints = async ({ organizationId, from, to } = {}) => {
  if (!organizationId) throw new Error("Organization ID is required");

  const settings = await loadActiveSettings(organizationId);
  if (!settings) {
    return {
      ran: false,
      reason: "reward_system_disabled",
      leave: { scanned: 0, created: 0, skipped: 0 },
      punctuality: { scanned: 0, created: 0, skipped: 0 },
    };
  }

  const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0];
  const requestedFrom = from ? String(from).slice(0, 10) : settings.start_date;
  // Never reach behind the start date: activity before it is not eligible.
  const rangeFrom = requestedFrom < settings.start_date ? settings.start_date : requestedFrom;
  const rangeTo = to ? String(to).slice(0, 10) : todayIST;

  const result = {
    ran: true,
    organization_id: Number(organizationId),
    from: rangeFrom,
    to: rangeTo,
    start_date: settings.start_date,
    settings_snapshot: {
      leave_early_enabled: settings.leave_early_enabled,
      leave_early_days_before: settings.leave_early_days_before,
      leave_early_points: settings.leave_early_points,
      punctuality_enabled: settings.punctuality_enabled,
    },
    leave: { scanned: 0, created: 0, skipped: 0 },
    punctuality: { scanned: 0, created: 0, skipped: 0 },
    errors: [],
  };

  if (rangeFrom > rangeTo) return result;

  // ── Approved leave, keyed by the existing approval-date source (updated_at) ──
  const leaveRows = await pool.query(
    `
      SELECT lr.id
      FROM leave_requests lr
      JOIN employees e ON e.id = lr.employee_id
      WHERE e.organization_id = $1
        AND lr.status = 'approved'
        AND DATE(COALESCE(lr.updated_at, lr.created_at)
                   AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
            BETWEEN $2::date AND $3::date
      ORDER BY lr.id ASC
    `,
    [organizationId, rangeFrom, rangeTo]
  );

  for (const row of leaveRows.rows) {
    result.leave.scanned += 1;
    try {
      const awarded = await awardLeaveEarlyApplication({ leaveRequestId: row.id });
      if (awarded.created) result.leave.created += 1;
      else result.leave.skipped += 1;
    } catch (error) {
      result.leave.skipped += 1;
      result.errors.push(`leave ${row.id}: ${error.message}`);
    }
  }

  // ── First IN punch per employee per IST calendar day ──
  const punchRows = await pool.query(
    `
      SELECT p.id, p.employee_id
      FROM (
        SELECT a.id,
               a.employee_id,
               ROW_NUMBER() OVER (
                 PARTITION BY a.employee_id,
                              DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
                 ORDER BY a.timestamp ASC, a.id ASC
               ) AS rn
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        WHERE e.organization_id = $1
          AND a.type = 'in'
          AND DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
              BETWEEN $2::date AND $3::date
      ) p
      WHERE p.rn = 1
      ORDER BY p.id ASC
    `,
    [organizationId, rangeFrom, rangeTo]
  );

  for (const row of punchRows.rows) {
    result.punctuality.scanned += 1;
    try {
      const awarded = await awardPunctuality({
        employeeId: row.employee_id,
        attendanceId: row.id,
      });
      if (awarded.created) result.punctuality.created += 1;
      else result.punctuality.skipped += 1;
    } catch (error) {
      result.punctuality.skipped += 1;
      result.errors.push(`attendance ${row.id}: ${error.message}`);
    }
  }

  return result;
};

module.exports = {
  LEAVE_RULE,
  PUNCTUALITY_RULE,
  awardLeaveEarlyApplication,
  awardPunctuality,
  reverseAwardsForLeaveRequest,
  backfillRewardPoints,
};
