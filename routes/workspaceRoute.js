// // routes/workspaceRoute.js
// const express = require("express");
// const router = express.Router();
// const {
//   getAllWorkspaces,
//   createWorkspace,
//   getAllWorkspacesByEmployeeId
// } = require("../controllers/workspaceCtrl");
// const { authenticate } = require("../middleware/authMiddleware");

// router.get("/", getAllWorkspaces);
// router.post("/", createWorkspace);

// router.get("/emp/workspace",authenticate, getAllWorkspacesByEmployeeId);

// module.exports = router;
const express = require("express");
const router = express.Router();
const {
  getAllWorkspaces,
  createWorkspace,
  getAllWorkspacesByEmployeeId,
  getTeamWorkspaces,
  updateWorkspace,
  toggleWorkspaceStatus
} = require("../controllers/workspaceCtrl");
const { authenticate } = require("../middleware/authMiddleware");

router.get("/", authenticate, getAllWorkspaces);
router.post("/", authenticate, createWorkspace);
router.get("/emp/workspace", authenticate, getAllWorkspacesByEmployeeId);
/**
 * @route GET /api/workspaces/team
 * @desc Get workspaces the logged-in employee's direct reports belong to (Reporting Manager view)
 * @access Private (any authenticated employee; returns empty data if caller has no direct reports)
 */
router.get("/team", authenticate, getTeamWorkspaces);
router.put("/:id", authenticate, updateWorkspace);
router.patch("/:id/toggle-status", authenticate, toggleWorkspaceStatus);

module.exports = router;
