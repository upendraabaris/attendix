const router = require("express").Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  saveWorkWeekPolicy,
  fetchWorkWeekPolicy,
  editWorkWeekPolicy,
} = require("../controllers/compOffController");

router.post("/", authenticate, authorizeRoles("admin"), saveWorkWeekPolicy);
router.get("/", authenticate, authorizeRoles("admin"), fetchWorkWeekPolicy);
router.put("/", authenticate, authorizeRoles("admin"), editWorkWeekPolicy);
router.put("/:id", authenticate, authorizeRoles("admin"), editWorkWeekPolicy);

module.exports = router;
