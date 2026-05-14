const express = require("express");

const router = express.Router();

const {
    startBreak,
    endBreak,
    getEmployeeBreakHistory
} = require("../controllers/breakControllers");



const { authenticate, authorizeRoles } =
    require("../middleware/authMiddleware");


router.post("/start", authenticate, startBreak);

router.post("/end", authenticate, endBreak);

// Admin only route
router.get(
    "/history/:employeeId",
    authenticate,
    authorizeRoles("admin"),
    getEmployeeBreakHistory
);


module.exports = router;