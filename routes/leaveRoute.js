const router = require("express").Router();
const {
  createLeaveRequest,
  getMyLeaveRequests,
  getMyLeaveBalances,
  getOrganizationLeaveBalanceReportCtrl,
  getEmployeeLeaveRequests,
  getAllLeaveRequests,
  getPendingLeaveRequests,
  updateLeaveRequestStatus,
  getLeaveBalanceHistoryCtrl,
} = require("../controllers/leaveCtrl");

const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");
const { leaveUpload } = require("../middleware/leaveUpload");

/**
 * @route POST /api/leave
 * @desc Submit a new leave request
 * @access Private (Employee)
 */
router.post('/', authenticate, leaveUpload.single("medicalProof"), createLeaveRequest);

/**
 * @route GET /api/leave/my
 * @desc Get leave requests for logged-in employee
 * @access Private (Employee)
 */
router.get('/my', authenticate, getMyLeaveRequests);

router.get('/my-balances', authenticate, getMyLeaveBalances);

router.get('/balance-report', authenticate, authorizeRoles('admin'), getOrganizationLeaveBalanceReportCtrl);

/**
 * @route GET /api/leave/employee/:employeeId
 * @desc Get leave requests for a specific employee
 * @access Private (Admin)
 */
router.get('/employee/:employeeId', authenticate, authorizeRoles('admin'), getEmployeeLeaveRequests);

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

/**
 * @route GET /api/leave/balance-history
 * @desc Get expired leave balance history per employee (admin report)
 * @access Private (Admin)
 * @query leaveType - optional, 'earned' | 'casual' (default: both)
 */
router.get('/balance-history', authenticate, authorizeRoles('admin'), getLeaveBalanceHistoryCtrl);

module.exports = router;
