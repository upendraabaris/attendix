const router = require("express").Router();
const { registerDeviceToken } = require("../controllers/deviceTokenCtrl");
const { authenticate } = require("../middleware/authMiddleware");

/**
 * @route POST /api/device-token
 * @desc Register or update the logged-in user's FCM device token
 * @access Private (Employee/Admin)
 */
router.post("/", authenticate, registerDeviceToken);

module.exports = router;
