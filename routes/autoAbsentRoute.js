const router = require("express").Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  fetchAutoAbsentSetting,
  runAutoAbsentForDate,
  saveAutoAbsentSetting,
  fetchAutoAbsentExclusions,
  saveAutoAbsentExclusions,
} = require("../controllers/autoAbsentController");

router.get("/settings", authenticate, authorizeRoles("admin"), fetchAutoAbsentSetting);
router.put("/settings", authenticate, authorizeRoles("admin"), saveAutoAbsentSetting);
router.post("/run", authenticate, authorizeRoles("admin"), runAutoAbsentForDate);
router.get("/exclusions", authenticate, authorizeRoles("admin"), fetchAutoAbsentExclusions);
router.put("/exclusions", authenticate, authorizeRoles("admin"), saveAutoAbsentExclusions);

module.exports = router;
