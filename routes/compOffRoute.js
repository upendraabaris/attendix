const router = require("express").Router();
const { authenticate } = require("../middleware/authMiddleware");
const {
  earnCompOffForWorkDay,
  fetchCompOffBalance,
  fetchCompOffHistory,
  markCompOffUsed,
} = require("../controllers/compOffController");

router.post("/earn", authenticate, earnCompOffForWorkDay);
router.get("/balance/:employee_id", authenticate, fetchCompOffBalance);
router.get("/history/:employee_id", authenticate, fetchCompOffHistory);
router.put("/use/:id", authenticate, markCompOffUsed);

module.exports = router;
