const router = require("express").Router();
const {
  createLeaveRequest,
  getMyLeaveRequests,
  getEmployeeLeaveRequests,
  getAllLeaveRequests,
  getPendingLeaveRequests,
  updateLeaveRequestStatus
} = require("../controllers/leaveCtrl");

const { authenticate } = require("../middleware/authMiddleware");

/**
 * @route POST /api/leave
 * @desc Submit a new leave request
 * @access Private (Employee)
 */
router.post('/', authenticate, createLeaveRequest);

/**
 * @route GET /api/leave/my
 * @desc Get leave requests for logged-in employee
 * @access Private (Employee)
 */
router.get('/my', authenticate, getMyLeaveRequests);

/**
 * @route GET /api/leave/employee/:employeeId
 * @desc Get leave requests for a specific employee
 * @access Private (Admin)
 */
router.get('/employee/:employeeId', getEmployeeLeaveRequests);

/**
 * @route GET /api/leave
 * @desc Get all leave requests
 * @access Private (Admin)
 */
router.get('/get', authenticate, getAllLeaveRequests);

/**
 * @route PUT /api/leave/:leaveId
 * @desc Update leave request status (approve/reject)
 * @access Private (Admin)
 */
router.put('/update/:leaveId', authenticate, updateLeaveRequestStatus);


router.get('/admin/leave-requests/pending', authenticate, getPendingLeaveRequests);

module.exports = router;
 