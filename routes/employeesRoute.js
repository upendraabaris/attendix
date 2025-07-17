const router = require("express").Router();
const { getAllEmployees, addEmployee, getLatestActivity, getEmployeeById, updateEmployee } = require("../controllers/employeeCtrl")
const {
  getEmployeeAttendance,
  getAllAttendance
} = require("../controllers/attendanceCtrl");

const { authenticate } = require("../middleware/authMiddleware");

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

/**
 * @route GET /api/leave/employee/:employeeId
 * @desc Get leave requests for a specific employee
 * @access Private (Admin)
 */
router.get('/getEmployees', getAllEmployees);


/**
 * @route GET /api/leave/employee/:employeeId
 * @desc Get leave requests for a specific employee
 * @access Private (Admin)
 */

router.post('/addEmployee', authenticate, addEmployee);

router.get('/latestActivity', authenticate, getLatestActivity);

router.get('/getEmployeeById/:id', getEmployeeById);

router.put('/updateEmployee/:id', updateEmployee);



module.exports = router;