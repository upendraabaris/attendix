const router = require("express").Router();

const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");


const { generateAttendanceReport, getEmployeeReportDetails } = require("../controllers/reportCtrl");

router.get("/attendance-summary", authenticate, authorizeRoles("admin"), generateAttendanceReport);
router.get("/employee-details", authenticate, authorizeRoles("admin"), getEmployeeReportDetails);


module.exports = router;

