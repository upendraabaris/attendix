const router = require("express").Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  createLeavePolicy,
  getLeavePolicies,
  editLeavePolicy,
} = require("../controllers/leavePolicyController");

router.post("/", authenticate, authorizeRoles("admin"), createLeavePolicy);
router.get("/", authenticate, authorizeRoles("admin"), getLeavePolicies);
router.put("/:id", authenticate, authorizeRoles("admin"), editLeavePolicy);

module.exports = router;
