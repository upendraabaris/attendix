const router = require("express").Router();
const { authenticate } = require("../middleware/authMiddleware");


const {
  loginAdmin,
  loginEmployee,
  getOrganizationsByPhone,
  registerUser,
  loginAdminDashboard,
  loginEmployeeDashboard,
  loginSupportDashboard,
  changePassword
} = require("../controllers/authCtrl");

// Admin login with email + password
router.post('/admin-login', loginAdmin);

// Employee login with mobile (OTP)
router.post('/employee-login', loginEmployee);

// Get list of all orgaizations by phone number
router.post('/organizations-by-phone', getOrganizationsByPhone);

// New User Registration
router.post('/register', registerUser);

// Admin login dashboard
router.post('/admin-dashboard', loginAdminDashboard);

// Support login dashboard
router.post('/support-dashboard', loginSupportDashboard);

// Employee web login with email + password
router.post('/employee/login/web', loginEmployeeDashboard);

// Change password (authenticated user only)
router.post('/change-password', authenticate, changePassword);






module.exports = router;
