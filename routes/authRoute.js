const router = require("express").Router();

const { loginAdmin, loginEmployee, getOrganizationsByPhone, registerUser } = require("../controllers/authCtrl");

// Admin login with email + password
router.post('/admin-login', loginAdmin);

// Employee login with mobile (OTP)
router.post('/employee-login', loginEmployee);

// Get list of all orgaizations by phone number
router.post('/organizations-by-phone', getOrganizationsByPhone);

// New User Registration
router.post('/register', registerUser);

module.exports = router;