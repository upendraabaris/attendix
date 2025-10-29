// routes/workspaceRoute.js
const express = require("express");
const router = express.Router();
const {
  getAllWorkspaces,
  createWorkspace,
  getAllWorkspacesByEmployeeId
} = require("../controllers/workspaceCtrl");
const { authenticate } = require("../middleware/authMiddleware");

router.get("/", getAllWorkspaces);
router.post("/", createWorkspace);

router.get("/emp/workspace",authenticate, getAllWorkspacesByEmployeeId);

module.exports = router;
