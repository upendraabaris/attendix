const router = require("express").Router();

const { loginAdmin, loginEmployee, getOrganizationsByPhone } = require("../controllers/authCtrl");

// Admin login with email + password
router.post('/admin-login', loginAdmin);

// Employee login with mobile (OTP)
router.post('/employee-login', loginEmployee);

// Get list of all orgaizations by phone number
router.post('/organizations-by-phone', getOrganizationsByPhone);

module.exports = router;