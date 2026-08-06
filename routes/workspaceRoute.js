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
  updateWorkspace,
  toggleWorkspaceStatus
} = require("../controllers/workspaceCtrl");
const { authenticate } = require("../middleware/authMiddleware");

router.get("/", authenticate, getAllWorkspaces);
router.post("/", authenticate, createWorkspace);
router.get("/emp/workspace", authenticate, getAllWorkspacesByEmployeeId);
router.put("/:id", authenticate, updateWorkspace);
router.patch("/:id/toggle-status", authenticate, toggleWorkspaceStatus);

module.exports = router;
