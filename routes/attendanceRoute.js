const router = require("express").Router();
const {
  clockIn,
  clockOut,
  getMyAttendance,
  getEmployeeAttendance,
  getAllAttendance
} = require("../controllers/attendanceCtrl");

const { authenticate } = require("../middleware/authMiddleware");

/**
 * @route POST /api/attendance/clock-in
 * @desc Clock in with geolocation
 * @access Private (Employee)
 */
router.post('/clock-in', authenticate, clockIn);

/**
 * @route POST /api/attendance/clock-out
 * @desc Clock out with geolocation
 * @access Private (Employee)
 */
router.post('/clock-out', authenticate, clockOut);

/**
 * @route GET /api/attendance/my
 * @desc Get attendance records for logged-in employee
 * @access Private (Employee)
 */
router.get('/my', authenticate, getMyAttendance);

module.exports = router;

//Get user api 