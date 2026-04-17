const router = require("express").Router();

const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");


const { generateAttendanceReport } = require("../controllers/reportCtrl");

router.get("/attendance-summary", authenticate, authorizeRoles("admin"), generateAttendanceReport);


module.exports = router;

