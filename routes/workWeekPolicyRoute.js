const router = require("express").Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  saveWorkWeekPolicy,
  fetchWorkWeekPolicy,
  checkWorkDateStatus,
  editWorkWeekPolicy,
} = require("../controllers/compOffController");

router.post("/", authenticate, authorizeRoles("admin"), saveWorkWeekPolicy);
router.get("/", authenticate, authorizeRoles("admin", "employee"), fetchWorkWeekPolicy);
router.get("/check", authenticate, authorizeRoles("admin", "employee"), checkWorkDateStatus);
router.put("/", authenticate, authorizeRoles("admin"), editWorkWeekPolicy);
router.put("/:id", authenticate, authorizeRoles("admin"), editWorkWeekPolicy);

module.exports = router;

