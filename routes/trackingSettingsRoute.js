const express = require("express");

const router = express.Router();

const {
    getTrackingSettings,
    updateTrackingSettings
} = require("../controllers/trackingSettingsController");

// middleware
const { authenticate, authorizeRoles } = require("../middleware/authMiddleware");

// GET SETTINGS
router.get(
    "/",
    authenticate,
    getTrackingSettings
);

// UPDATE SETTINGS
router.put(
    "/",
    authenticate,
    authorizeRoles("admin"),
    updateTrackingSettings
);

module.exports = router;