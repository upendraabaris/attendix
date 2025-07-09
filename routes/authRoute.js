const router = require("express").Router();

const {loginAdmin,loginEmployee} = require("../controllers/authCtrl");

// Admin login with email + password
router.post('/admin-login', loginAdmin);

// Employee login with mobile (OTP)
router.post('/employee-login', loginEmployee);

module.exports = router;