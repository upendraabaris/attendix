const express = require("express");
const router = express.Router();
const { createMasterTask, getMasterTasks, updateMasterTask, getMyMasterTasks, toggleMasterTaskStatus } = require("../controllers/masterTaskCtrl");
const { authenticate } = require("../middleware/authMiddleware");

router.post("/create", authenticate, createMasterTask);
router.get("/workspace/:workspace_id", authenticate, getMasterTasks);
router.put("/update/:id", authenticate, updateMasterTask);
router.get("/my", authenticate, getMyMasterTasks);
router.patch("/:id/toggle-status", authenticate, toggleMasterTaskStatus);

module.exports = router;
