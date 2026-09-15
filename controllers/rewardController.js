const {
  getRewardSettings,
  upsertRewardSettings,
  getPunctualitySlabs,
  createPunctualitySlab,
  updatePunctualitySlab,
  deletePunctualitySlab,
} = require("../services/rewardSettingsService");
const {
  getOrganizationRanking,
  getEmployeeRanking,
} = require("../services/rewardRankingService");
const { backfillRewardPoints } = require("../services/rewardPointsService");

// Reward Points controller. Organization scope always comes from the JWT —
// never from the request body or query string (strict organization isolation).
// See REWARD_POINTS_MODULE.md section 6.3.

const hasAdminAccess = (req) =>
  String(req.user?.role || "").toLowerCase().includes("admin");

const ensureAdminAccess = (req, res) => {
  if (!hasAdminAccess(req)) {
    res.status(403).json({
      statusCode: 403,
      message: "Forbidden: admin access required",
    });
    return false;
  }
  return true;
};

const ensureOrganization = (req, res) => {
  const organizationId = req.user?.organization_id;
  if (!organizationId) {
    res.status(400).json({
      statusCode: 400,
      message: "Organization ID missing in token",
    });
    return null;
  }
  return organizationId;
};

// Validation errors from the services carry recognizable messages.
const isValidationError = (error) =>
  /invalid|required|must|already exists/i.test(error?.message || "");

const sendError = (res, error, fallbackMessage) => {
  const validation = isValidationError(error);
  return res.status(validation ? 400 : 500).json({
    statusCode: validation ? 400 : 500,
    message: error?.message || fallbackMessage,
    error: error?.message,
  });
};

const parseSlabId = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const fetchRewardSettings = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const [settings, slabs] = await Promise.all([
      getRewardSettings(organizationId),
      getPunctualitySlabs(organizationId),
    ]);

    return res.status(200).json({
      statusCode: 200,
      message: "Reward settings retrieved successfully",
      data: { ...settings, slabs },
    });
  } catch (error) {
    console.error("Error retrieving reward settings:", error);
    return sendError(res, error, "Failed to retrieve reward settings");
  }
};

const saveRewardSettings = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const settings = await upsertRewardSettings(organizationId, req.body || {});
    const slabs = await getPunctualitySlabs(organizationId);

    return res.status(200).json({
      statusCode: 200,
      message: "Reward settings saved successfully",
      data: { ...settings, slabs },
    });
  } catch (error) {
    console.error("Error saving reward settings:", error);
    return sendError(res, error, "Failed to save reward settings");
  }
};

const addPunctualitySlab = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const slab = await createPunctualitySlab(organizationId, req.body || {});
    return res.status(201).json({
      statusCode: 201,
      message: "Punctuality slab created successfully",
      data: slab,
    });
  } catch (error) {
    console.error("Error creating punctuality slab:", error);
    return sendError(res, error, "Failed to create punctuality slab");
  }
};

const editPunctualitySlab = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const slabId = parseSlabId(req.params.id);
  if (!slabId) {
    return res.status(400).json({
      statusCode: 400,
      message: "A valid slab id is required",
    });
  }

  try {
    const slab = await updatePunctualitySlab(organizationId, slabId, req.body || {});
    if (!slab) {
      return res.status(404).json({
        statusCode: 404,
        message: "Punctuality slab not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Punctuality slab updated successfully",
      data: slab,
    });
  } catch (error) {
    console.error("Error updating punctuality slab:", error);
    return sendError(res, error, "Failed to update punctuality slab");
  }
};

const removePunctualitySlab = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const slabId = parseSlabId(req.params.id);
  if (!slabId) {
    return res.status(400).json({
      statusCode: 400,
      message: "A valid slab id is required",
    });
  }

  try {
    const deleted = await deletePunctualitySlab(organizationId, slabId);
    if (!deleted) {
      return res.status(404).json({
        statusCode: 404,
        message: "Punctuality slab not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Punctuality slab deleted successfully",
      data: deleted,
    });
  } catch (error) {
    console.error("Error deleting punctuality slab:", error);
    return sendError(res, error, "Failed to delete punctuality slab");
  }
};

/**
 * GET /api/rewards/ranking — organization-wide employee ranking (admin only).
 * Admin exclusion and organization scoping are enforced in SQL.
 */
const fetchOrganizationRanking = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const ranking = await getOrganizationRanking(organizationId, {
      from: req.query.from,
      to: req.query.to,
    });

    return res.status(200).json({
      statusCode: 200,
      message: ranking.rewardSystemEnabled
        ? "Employee ranking retrieved successfully"
        : "Reward system is disabled",
      rewardSystemEnabled: ranking.rewardSystemEnabled,
      from: ranking.from,
      to: ranking.to,
      data: ranking.data,
    });
  } catch (error) {
    console.error("Error retrieving employee ranking:", error);
    return sendError(res, error, "Failed to retrieve employee ranking");
  }
};

/**
 * GET /api/rewards/my-ranking — the caller's own points and rank.
 * Any authenticated employee may call this; admins have no reward points and
 * are excluded from ranking, so they receive a null payload.
 */
const fetchMyRanking = async (req, res) => {
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  const employeeId = req.user?.employee_id;
  if (!employeeId) {
    return res.status(400).json({
      statusCode: 400,
      message: "Employee ID missing in token",
    });
  }

  try {
    const ranking = await getEmployeeRanking(organizationId, employeeId, {
      from: req.query.from,
      to: req.query.to,
    });

    return res.status(200).json({
      statusCode: 200,
      message: ranking.rewardSystemEnabled
        ? "Reward ranking retrieved successfully"
        : "Reward system is disabled",
      rewardSystemEnabled: ranking.rewardSystemEnabled,
      from: ranking.from,
      to: ranking.to,
      data: ranking.data,
      // Rank #1 holder(s) for the same period, so every employee can see who
      // is topping the board. Derived from the same ranking result as `data`.
      topRankers: ranking.top_rankers || [],
    });
  } catch (error) {
    console.error("Error retrieving own reward ranking:", error);
    return sendError(res, error, "Failed to retrieve reward ranking");
  }
};

/**
 * POST /api/rewards/backfill — explicit, admin-triggered historical calculation.
 *
 * Stores missing ledger rows for existing activity from the reward start date
 * onward. Idempotent: existing earned rows are never changed or duplicated.
 * This is the ONLY way historical rewards come into being — moving the start
 * date backward does not create them automatically.
 */
const runRewardBackfill = async (req, res) => {
  if (!ensureAdminAccess(req, res)) return;
  const organizationId = ensureOrganization(req, res);
  if (!organizationId) return;

  try {
    const summary = await backfillRewardPoints({
      organizationId,
      from: req.body?.from || req.query?.from,
      to: req.body?.to || req.query?.to,
    });

    return res.status(200).json({
      statusCode: 200,
      message: summary.ran
        ? "Reward points backfill completed"
        : "Reward system is disabled — nothing to backfill",
      data: summary,
    });
  } catch (error) {
    console.error("Error running reward points backfill:", error);
    return sendError(res, error, "Failed to run reward points backfill");
  }
};

module.exports = {
  fetchRewardSettings,
  saveRewardSettings,
  addPunctualitySlab,
  editPunctualitySlab,
  removePunctualitySlab,
  fetchOrganizationRanking,
  fetchMyRanking,
  runRewardBackfill,
};
