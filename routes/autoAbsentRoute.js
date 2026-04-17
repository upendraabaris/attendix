const router = require("express").Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  fetchAutoAbsentSetting,
  runAutoAbsentForDate,
  saveAutoAbsentSetting,
} = require("../controllers/autoAbsentController");

router.get("/settings", authenticate, authorizeRoles("admin"), fetchAutoAbsentSetting);
router.put("/settings", authenticate, authorizeRoles("admin"), saveAutoAbsentSetting);
router.post("/run", authenticate, authorizeRoles("admin"), runAutoAbsentForDate);

module.exports = router;
