const router = require("express").Router();
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const {
  addHoliday,
  getHolidays,
  editHoliday,
  removeHoliday,
} = require("../controllers/compOffController");

router.post("/", authenticate, authorizeRoles("admin"), addHoliday);
router.get("/", authenticate, authorizeRoles("admin"), getHolidays);
router.put("/:id", authenticate, authorizeRoles("admin"), editHoliday);
router.delete("/:id", authenticate, authorizeRoles("admin"), removeHoliday);

module.exports = router;
