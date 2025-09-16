const express = require("express");
const router = express.Router();
const { createTask, getMyTasks, updateTaskStatus, getAllEmployeesTasks, assignTask } = require("../controllers/taskCtrl");
const { authenticate } = require("../middleware/authMiddleware");

router.post("/create", authenticate, createTask);
router.get("/my", authenticate, getMyTasks);
router.post("/update-status", authenticate, updateTaskStatus);
router.get("/all", authenticate, getAllEmployeesTasks);
router.post("/assignTask", authenticate, assignTask);

module.exports = router;
