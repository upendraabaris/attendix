const express = require("express");
const router = express.Router();

const { checkVersion, updateVersion } = require("../controllers/appVersionCtrl");
const developerAuth = require("../middleware/developerAuth");

// ──────────────────────────────────────────────────────────
// GET /api/version/check
// Public — no auth required.
// Called by the mobile app (iOS & Android) on every startup.
//
// Query params:
//   platform         : 'android' | 'ios'
//   current_version  : e.g. '1.0.0'
//
// Example:
//   GET /api/version/check?platform=android&current_version=1.0.0
// ──────────────────────────────────────────────────────────
router.get("/check", checkVersion);

// ──────────────────────────────────────────────────────────
// POST /api/version/update
// Developer-only. Protected by x-developer-key header.
// Call this via Postman after every store release.
//
// Headers:
//   x-developer-key: <DEVELOPER_SECRET_KEY from .env>
//
// Body (JSON):
//   {
//     "platform"        : "android" | "ios",
//     "version"         : "1.1.0",
//     "is_force_update" : false,
//     "release_notes"   : "Bug fixes and performance improvements",
//     "store_url"       : "https://play.google.com/store/apps/details?id=com.attendix"
//   }
// ──────────────────────────────────────────────────────────
router.post("/update", developerAuth, updateVersion);

module.exports = router;
