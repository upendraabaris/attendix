const router = require("express").Router();
const { authenticate } = require("../middleware/authMiddleware");

const { 
  loginAdmin, 
  loginEmployee, 
  getOrganizationsByPhone, 
  registerUser, 
  loginAdminDashboard,
  changePassword
} = require("../controllers/authCtrl");

// ================================
// Auth Routes
// ================================

// Admin login with phone + org_id
router.post('/admin-login', loginAdmin);

// Employee login with mobile (OTP verified separately)
router.post('/employee-login', loginEmployee);

// Get list of organizations by phone number
router.post('/organizations-by-phone', getOrganizationsByPhone);

// New User Registration
router.post('/register', registerUser);

// Admin login dashboard (email + password)
router.post('/admin-dashboard', loginAdminDashboard);

// Change password (authenticated user only)
router.post('/change-password', authenticate, changePassword);

module.exports = router;
