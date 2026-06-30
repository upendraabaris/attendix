const express = require("express");
const router = express.Router();
const { createMasterTask, getMasterTasks } = require("../controllers/masterTaskCtrl");
const { authenticate } = require("../middleware/authMiddleware");

router.post("/create", authenticate, createMasterTask);
router.get("/workspace/:workspace_id", authenticate, getMasterTasks);

module.exports = router;
