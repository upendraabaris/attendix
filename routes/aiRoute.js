const express = require("express");
const router = express.Router();
const { extractTasks } = require("../controllers/aiCtrl");
const { authenticate } = require("../middleware/authMiddleware");

// Route to process meeting transcript
router.post("/extract-tasks", authenticate, extractTasks);

module.exports = router;
