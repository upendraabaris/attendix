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

/**
 * @route GET /api/attendance/employee/:employeeId
 * @desc Get attendance records for a specific employee
 * @access Private (Admin)
 */
router.get('/employee', authenticate, getEmployeeAttendance);

/**
 * @route GET /api/attendance
 * @desc Get all attendance records
 * @access Private (Admin)
 */
router.get('/', getAllAttendance);

module.exports = router;