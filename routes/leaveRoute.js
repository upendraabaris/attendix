const router = require("express").Router();
const { 
  createLeaveRequest, 
  getMyLeaveRequests, 
  getEmployeeLeaveRequests, 
  getAllLeaveRequests, 
  updateLeaveRequestStatus 
} = require("../controllers/leaveCtrl");

/**
 * @route POST /api/leave
 * @desc Submit a new leave request
 * @access Private (Employee)
 */
router.post('/', createLeaveRequest);

/**
 * @route GET /api/leave/my
 * @desc Get leave requests for logged-in employee
 * @access Private (Employee)
 */
router.get('/my', getMyLeaveRequests);

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
router.get('/get', getAllLeaveRequests);

/**
 * @route PUT /api/leave/:leaveId
 * @desc Update leave request status (approve/reject)
 * @access Private (Admin)
 */
router.put('/update/:leaveId', updateLeaveRequestStatus);

module.exports = router;
