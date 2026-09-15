const express = require("express");
const router = express.Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  fetchRewardSettings,
  saveRewardSettings,
  addPunctualitySlab,
  editPunctualitySlab,
  removePunctualitySlab,
  fetchOrganizationRanking,
  fetchMyRanking,
  runRewardBackfill,
} = require("../controllers/rewardController");

// Reward Points & Employee Ranking routes.
// Admin config endpoints are gated at both the route level (authorizeRoles) and
// inside the controller (ensureAdminAccess) — defense in depth, matching the
// leave-policy routes. See REWARD_POINTS_MODULE.md section 6.3.

router.get("/settings", authenticate, authorizeRoles("admin"), fetchRewardSettings);
router.put("/settings", authenticate, authorizeRoles("admin"), saveRewardSettings);

router.post("/slabs", authenticate, authorizeRoles("admin"), addPunctualitySlab);
router.put("/slabs/:id", authenticate, authorizeRoles("admin"), editPunctualitySlab);
router.delete("/slabs/:id", authenticate, authorizeRoles("admin"), removePunctualitySlab);

// Full organization ranking is admin-only. Employees see only their own rank.
router.get("/ranking", authenticate, authorizeRoles("admin"), fetchOrganizationRanking);
router.get("/my-ranking", authenticate, fetchMyRanking);

// Explicit historical calculation. Idempotent; never modifies earned rows.
router.post("/backfill", authenticate, authorizeRoles("admin"), runRewardBackfill);

module.exports = router;
