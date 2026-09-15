const pool = require("../configure/dbConfig");

// Employee reward ranking. Aggregates the ledger over a date range.
// Organization scoping and admin exclusion are enforced here, in SQL — the
// frontend must never be the only gate. See REWARD_POINTS_MODULE.md sections
// 3.5, 3.6 and 6.6.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** IST calendar date for "now", independent of the Node host timezone. */
const getISTToday = () => {
  const shifted = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return shifted.toISOString().split("T")[0];
};

/** First day of the current IST month. */
const getISTFirstDayOfMonth = () => `${getISTToday().slice(0, 7)}-01`;

const isValidDateString = (value) => {
  if (!DATE_PATTERN.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
};

/**
 * Resolves the requested reporting window, defaulting to
 * first-day-of-current-month .. today (both IST).
 */
const resolveDateRange = (from, to) => {
  const fromDate = from && String(from).trim() !== "" ? String(from).slice(0, 10) : getISTFirstDayOfMonth();
  const toDate = to && String(to).trim() !== "" ? String(to).slice(0, 10) : getISTToday();

  if (!isValidDateString(fromDate)) {
    throw new Error("from must be a valid date in YYYY-MM-DD format");
  }
  if (!isValidDateString(toDate)) {
    throw new Error("to must be a valid date in YYYY-MM-DD format");
  }
  if (fromDate > toDate) {
    // Wording matters: the controller classifies validation errors by message.
    throw new Error("from date must not be after the to date");
  }

  return { from: fromDate, to: toDate };
};

/**
 * Loads reward settings needed for ranking. Returns null when the reward system
 * is disabled (or has no start date), meaning no ranking may be shown at all.
 */
const loadRankingSettings = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT is_enabled, start_date::text AS start_date
      FROM reward_settings
      WHERE organization_id = $1
      LIMIT 1
    `,
    [organizationId]
  );

  const settings = result.rows[0];
  if (!settings || !settings.is_enabled || !settings.start_date) return null;
  return settings;
};

/**
 * Organization-wide ranking for a date range.
 *
 * LEDGER-BASED AND IMMUTABLE. Points are read from employee_reward_points and
 * are never recalculated here: a stored point is an EARNED point, so later
 * changes to punctuality slabs, leave-early settings or an employee's Expected
 * Clock-In Time can never retroactively alter, hide or remove it.
 *
 * Awards are created only by the live hooks (leave approval / clock-in) and by
 * the explicit one-time backfill. This query is strictly read-only.
 *
 * The reward system start date still clamps the reporting window for
 * VISIBILITY, which never modifies or deletes a ledger row.
 *
 * Returns { rewardSystemEnabled, from, to, data }.
 * When the system is disabled, data is an empty array.
 */
const getOrganizationRanking = async (organizationId, { from, to } = {}) => {
  if (!organizationId) throw new Error("Organization ID is required");

  const range = resolveDateRange(from, to);
  const settings = await loadRankingSettings(organizationId);

  if (!settings) {
    return { rewardSystemEnabled: false, from: range.from, to: range.to, data: [] };
  }

  // Visibility clamp only — earned rows outside the window are retained, just
  // not counted for this period.
  const effectiveFrom = range.from > settings.start_date ? range.from : settings.start_date;

  // An empty window (start date after the requested end) yields zero points for
  // everyone rather than an error.
  //
  // Deliberately NOT filtered by employees.expected_clock_in_time: clearing an
  // employee's expected clock-in stops FUTURE punctuality awards, but must never
  // hide points they have already earned.
  const result = await pool.query(
    `
      SELECT e.id                            AS employee_id,
             e.name                          AS employee_name,
             e.email,
             COALESCE(SUM(r.points), 0)::int AS reward_points,
             DENSE_RANK() OVER (ORDER BY COALESCE(SUM(r.points), 0) DESC)::int AS rank
      FROM employees e
      LEFT JOIN employee_reward_points r
             ON r.employee_id = e.id
            AND r.status      = 'active'
            AND r.award_date BETWEEN $2::date AND $3::date
      WHERE e.organization_id = $1
        AND COALESCE(e.status, 'active') = 'active'
        AND LOWER(TRIM(COALESCE(e.role, ''))) <> 'admin'
      GROUP BY e.id, e.name, e.email
      ORDER BY reward_points DESC, e.name ASC
    `,
    [organizationId, effectiveFrom, range.to]
  );

  return {
    rewardSystemEnabled: true,
    from: range.from,
    to: range.to,
    effective_from: effectiveFrom,
    start_date: settings.start_date,
    data: result.rows,
  };
};

/**
 * A single employee's own points and rank for a date range.
 * Derived from the same ranking query so the employee view and the admin board
 * can never disagree.
 */
const getEmployeeRanking = async (organizationId, employeeId, { from, to } = {}) => {
  if (!organizationId) throw new Error("Organization ID is required");
  if (!employeeId) throw new Error("Employee ID is required");

  const ranking = await getOrganizationRanking(organizationId, { from, to });

  if (!ranking.rewardSystemEnabled) {
    return {
      rewardSystemEnabled: false,
      from: ranking.from,
      to: ranking.to,
      data: null,
      top_rankers: [],
    };
  }

  // Rank #1 holders, read straight off the ranking already computed above — no
  // second calculation. Employees on zero points are not "top rankers", and
  // DENSE_RANK would otherwise put the whole org at rank 1 in an empty period.
  const topRankers = ranking.data
    .filter((row) => Number(row.rank) === 1 && Number(row.reward_points) > 0)
    .map((row) => ({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      reward_points: row.reward_points,
    }));

  const own = ranking.data.find((row) => Number(row.employee_id) === Number(employeeId));

  return {
    rewardSystemEnabled: true,
    from: ranking.from,
    to: ranking.to,
    effective_from: ranking.effective_from,
    start_date: ranking.start_date,
    data: own
      ? {
          employee_id: own.employee_id,
          employee_name: own.employee_name,
          reward_points: own.reward_points,
          rank: own.rank,
          total_ranked: ranking.data.length,
        }
      : null,
    top_rankers: topRankers,
  };
};

module.exports = {
  resolveDateRange,
  getISTToday,
  getISTFirstDayOfMonth,
  getOrganizationRanking,
  getEmployeeRanking,
};
