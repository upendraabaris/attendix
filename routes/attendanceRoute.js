const router = require("express").Router();
const {
  clockIn,
  clockOut,
  getMyAttendance,
  getEmployeeAttendance,
  getAllAttendance,
  getAttendanceByAdmin,
  getParticularAttendance,
  adminUpdateClockOut
} = require("../controllers/attendanceCtrl");

const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

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


router.get('/admin/all-employee-attendance', authenticate, authorizeRoles('admin'), getAllAttendance);

router.post('/admin/get-single-attendance', authenticate, authorizeRoles('admin'), getAttendanceByAdmin);

router.get('/admin/get-particular-attendance', authenticate, getParticularAttendance);

/**
 * @route POST /api/attendance/admin/update-clockout
 * @desc Admin manually adds a missing clock-out with time and remark
 * @access Private (Admin)
 */
router.post('/admin/update-clockout', authenticate, authorizeRoles('admin'), adminUpdateClockOut);

module.exports = router;

//Get user api 