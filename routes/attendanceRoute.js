const router = require("express").Router();
const { 
  clockIn, 
  clockOut, 
  getMyAttendance, 
  getEmployeeAttendance, 
  getAllAttendance 
} = require("../controllers/attendanceCtrl");

/**
 * @route POST /api/attendance/clock-in
 * @desc Clock in with geolocation
 * @access Private (Employee)
 */
router.post('/clock-in', clockIn);

/**
 * @route POST /api/attendance/clock-out
 * @desc Clock out with geolocation
 * @access Private (Employee)
 */
router.post('/clock-out', clockOut);

/**
 * @route GET /api/attendance/my
 * @desc Get attendance records for logged-in employee
 * @access Private (Employee)
 */
router.get('/my', getMyAttendance);

/**
 * @route GET /api/attendance/employee/:employeeId
 * @desc Get attendance records for a specific employee
 * @access Private (Admin)
 */
router.get('/employee/:employeeId', getEmployeeAttendance);

/**
 * @route GET /api/attendance
 * @desc Get all attendance records
 * @access Private (Admin)
 */
router.get('/', getAllAttendance);

module.exports = router;