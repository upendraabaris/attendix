const pool = require("../configure/dbConfig");

// Reward Points settings are organization level. Nothing here is hardcoded —
// every threshold and point value comes from the database.
// See REWARD_POINTS_MODULE.md sections 3, 4.1, 4.2 and 6.4.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toBoolean = (value, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const parseNonNegativeInt = (value, fieldName) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative whole number`);
  }
  return parsed;
};

const isValidDateString = (value) => {
  if (!DATE_PATTERN.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
};

/**
 * Validates and normalizes a reward settings payload.
 * Throws Error instances whose messages the controller maps to HTTP 400.
 */
const validateRewardSettings = (payload = {}) => {
  const isEnabled = toBoolean(payload.is_enabled ?? payload.isEnabled, false);
  const leaveEarlyEnabled = toBoolean(
    payload.leave_early_enabled ?? payload.leaveEarlyEnabled,
    false
  );
  const punctualityEnabled = toBoolean(
    payload.punctuality_enabled ?? payload.punctualityEnabled,
    false
  );

  const rawStartDate = payload.start_date ?? payload.startDate ?? null;
  let startDate = null;
  if (rawStartDate !== null && rawStartDate !== undefined && String(rawStartDate).trim() !== "") {
    if (!isValidDateString(rawStartDate)) {
      throw new Error("start_date must be a valid date in YYYY-MM-DD format");
    }
    startDate = String(rawStartDate);
  }

  // The start date anchors every eligibility check, so it is mandatory once the
  // system is switched on.
  if (isEnabled && !startDate) {
    throw new Error("start_date is required when the reward system is enabled");
  }

  let daysBefore = null;
  let points = null;
  if (leaveEarlyEnabled) {
    const rawDays = payload.leave_early_days_before ?? payload.leaveEarlyDaysBefore;
    const rawPoints = payload.leave_early_points ?? payload.leaveEarlyPoints;

    if (rawDays === null || rawDays === undefined || String(rawDays).trim() === "") {
      throw new Error("leave_early_days_before is required when the leave early reward is enabled");
    }
    if (rawPoints === null || rawPoints === undefined || String(rawPoints).trim() === "") {
      throw new Error("leave_early_points is required when the leave early reward is enabled");
    }

    daysBefore = parseNonNegativeInt(rawDays, "leave_early_days_before");
    points = parseNonNegativeInt(rawPoints, "leave_early_points");
  }

  return {
    is_enabled: isEnabled,
    start_date: startDate,
    leave_early_enabled: leaveEarlyEnabled,
    leave_early_days_before: daysBefore,
    leave_early_points: points,
    punctuality_enabled: punctualityEnabled,
  };
};

/**
 * Validates a punctuality slab payload.
 * A slab means: "late by no more than max_minutes_late minutes -> points".
 */
const validateSlab = (payload = {}) => {
  const rawMinutes = payload.max_minutes_late ?? payload.maxMinutesLate;
  const rawPoints = payload.points;

  if (rawMinutes === null || rawMinutes === undefined || String(rawMinutes).trim() === "") {
    throw new Error("max_minutes_late is required");
  }
  if (rawPoints === null || rawPoints === undefined || String(rawPoints).trim() === "") {
    throw new Error("points is required");
  }

  return {
    max_minutes_late: parseNonNegativeInt(rawMinutes, "max_minutes_late"),
    points: parseNonNegativeInt(rawPoints, "points"),
  };
};

const DEFAULT_SETTINGS = (organizationId) => ({
  id: null,
  organization_id: Number(organizationId),
  is_enabled: false,
  start_date: null,
  leave_early_enabled: false,
  leave_early_days_before: null,
  leave_early_points: null,
  punctuality_enabled: false,
  created_at: null,
  updated_at: null,
});

/**
 * Returns the organization's reward settings, synthesizing a disabled default
 * row when none exists yet (same contract as getAutoAbsentSetting).
 */
const getRewardSettings = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT id, organization_id, is_enabled,
             -- ::text keeps this a calendar date. Without it node-postgres returns
             -- a JS Date at LOCAL midnight, which res.json() serializes via
             -- toISOString() and shifts to the previous day in any UTC+ timezone.
             start_date::text AS start_date,
             leave_early_enabled, leave_early_days_before, leave_early_points,
             punctuality_enabled, created_at, updated_at
      FROM reward_settings
      WHERE organization_id = $1
      LIMIT 1
    `,
    [organizationId]
  );

  return result.rows[0] || DEFAULT_SETTINGS(organizationId);
};

const upsertRewardSettings = async (organizationId, payload) => {
  const data = validateRewardSettings(payload);

  const result = await pool.query(
    `
      INSERT INTO reward_settings (
        organization_id, is_enabled, start_date,
        leave_early_enabled, leave_early_days_before, leave_early_points,
        punctuality_enabled, created_at, updated_at
      )
      VALUES ($1, $2, $3::date, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (organization_id)
      DO UPDATE SET
        is_enabled              = EXCLUDED.is_enabled,
        start_date              = EXCLUDED.start_date,
        leave_early_enabled     = EXCLUDED.leave_early_enabled,
        leave_early_days_before = EXCLUDED.leave_early_days_before,
        leave_early_points      = EXCLUDED.leave_early_points,
        punctuality_enabled     = EXCLUDED.punctuality_enabled,
        updated_at              = NOW()
      RETURNING id, organization_id, is_enabled,
                -- ::text for the same reason as getRewardSettings above: the save
                -- response feeds straight back into the form.
                start_date::text AS start_date,
                leave_early_enabled, leave_early_days_before, leave_early_points,
                punctuality_enabled, created_at, updated_at
    `,
    [
      organizationId,
      data.is_enabled,
      data.start_date,
      data.leave_early_enabled,
      data.leave_early_days_before,
      data.leave_early_points,
      data.punctuality_enabled,
    ]
  );

  return result.rows[0];
};

const getPunctualitySlabs = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT id, organization_id, max_minutes_late, points, created_at, updated_at
      FROM reward_punctuality_slabs
      WHERE organization_id = $1
      ORDER BY max_minutes_late ASC
    `,
    [organizationId]
  );
  return result.rows;
};

const DUPLICATE_SLAB_MESSAGE =
  "A slab for this max_minutes_late already exists for your organization";

const createPunctualitySlab = async (organizationId, payload) => {
  const data = validateSlab(payload);

  const result = await pool.query(
    `
      INSERT INTO reward_punctuality_slabs
        (organization_id, max_minutes_late, points, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (organization_id, max_minutes_late) DO NOTHING
      RETURNING id, organization_id, max_minutes_late, points, created_at, updated_at
    `,
    [organizationId, data.max_minutes_late, data.points]
  );

  // Surface a duplicate as a validation error rather than a constraint 500.
  if (!result.rows.length) {
    throw new Error(DUPLICATE_SLAB_MESSAGE);
  }

  return result.rows[0];
};

const updatePunctualitySlab = async (organizationId, slabId, payload) => {
  const data = validateSlab(payload);

  // Tenant safety: the id must belong to the caller's organization.
  const existing = await pool.query(
    `SELECT id FROM reward_punctuality_slabs WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [slabId, organizationId]
  );
  if (!existing.rows.length) {
    return null;
  }

  const clash = await pool.query(
    `
      SELECT id FROM reward_punctuality_slabs
      WHERE organization_id = $1 AND max_minutes_late = $2 AND id <> $3
      LIMIT 1
    `,
    [organizationId, data.max_minutes_late, slabId]
  );
  if (clash.rows.length) {
    throw new Error(DUPLICATE_SLAB_MESSAGE);
  }

  const result = await pool.query(
    `
      UPDATE reward_punctuality_slabs
      SET max_minutes_late = $1,
          points           = $2,
          updated_at       = NOW()
      WHERE id = $3 AND organization_id = $4
      RETURNING id, organization_id, max_minutes_late, points, created_at, updated_at
    `,
    [data.max_minutes_late, data.points, slabId, organizationId]
  );

  return result.rows[0] || null;
};

const deletePunctualitySlab = async (organizationId, slabId) => {
  const result = await pool.query(
    `
      DELETE FROM reward_punctuality_slabs
      WHERE id = $1 AND organization_id = $2
      RETURNING id
    `,
    [slabId, organizationId]
  );
  return result.rows[0] || null;
};

module.exports = {
  validateRewardSettings,
  validateSlab,
  getRewardSettings,
  upsertRewardSettings,
  getPunctualitySlabs,
  createPunctualitySlab,
  updatePunctualitySlab,
  deletePunctualitySlab,
};
