const express = require("express");

const router = express.Router();

const {
    startBreak,
    endBreak,
    getEmployeeBreakHistory,
    getTodayBreakStatus,
    getAttendanceBreakSummary
} = require("../controllers/breakControllers");

const { authenticate, authorizeRoles } =
    require("../middleware/authMiddleware");

router.post("/start", authenticate, startBreak);

router.post("/end", authenticate, endBreak);

// Attendance daily break summary route (accessible to authenticated employees & admin)
router.get(
    "/attendance-summary/:employeeId",
    authenticate,
    getAttendanceBreakSummary
);
router.get("/today-status", authenticate, getTodayBreakStatus);

// Admin only route for detailed break history
router.get(
    "/history/:employeeId",
    authenticate,
    authorizeRoles("admin"),
    getEmployeeBreakHistory
);


module.exports = router;