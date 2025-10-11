// routes/workspaceRoute.js
const express = require("express");
const router = express.Router();
const {
  getAllWorkspaces,
  createWorkspace,
} = require("../controllers/workspaceCtrl");

router.get("/", getAllWorkspaces);
router.post("/", createWorkspace);

module.exports = router;
