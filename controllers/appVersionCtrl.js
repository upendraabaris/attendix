/**
 * appVersionCtrl.js
 * ------------------
 * Controller for app version checking and updating.
 *
 * Endpoints:
 *   GET  /api/version/check   - Public. Called by mobile app on every startup.
 *   POST /api/version/update  - Developer-only. Called via Postman after a store release.
 */

const pool = require("../configure/dbConfig");

// ─────────────────────────────────────────────
// Helper: Compare two semver strings
// Returns:
//   -1  if versionA < versionB  (update available)
//    0  if versionA === versionB
//    1  if versionA > versionB  (client is ahead — no update)
// ─────────────────────────────────────────────
const compareSemver = (versionA, versionB) => {
    const parseVersion = (v) =>
        v
            .trim()
            .split(".")
            .map((n) => parseInt(n, 10) || 0);

    const [aMajor, aMinor, aPatch] = parseVersion(versionA);
    const [bMajor, bMinor, bPatch] = parseVersion(versionB);

    if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
    if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
    if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
    return 0;
};

// ─────────────────────────────────────────────
// GET /api/version/check
// Query params: platform, current_version
//
// Example:
//   GET /api/version/check?platform=android&current_version=1.0.0
// ─────────────────────────────────────────────
const checkVersion = async (req, res) => {
    const { platform, current_version } = req.query;

    if (!platform || !current_version) {
        return res.status(400).json({
            message: "Missing required query parameters: platform, current_version",
        });
    }

    const normalizedPlatform = platform.toLowerCase().trim();
    if (!["android", "ios"].includes(normalizedPlatform)) {
        return res.status(400).json({
            message: "Invalid platform. Must be 'android' or 'ios'.",
        });
    }

    try {
        const result = await pool.query(
            "SELECT * FROM app_versions WHERE platform = $1",
            [normalizedPlatform]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: `No version record found for platform: ${normalizedPlatform}`,
            });
        }

        const record = result.rows[0];
        const comparison = compareSemver(current_version, record.version);
        const updateAvailable = comparison === -1; // current < latest

        return res.status(200).json({
            update_available: updateAvailable,
            current_version: current_version,
            latest_version: record.version,
            is_force_update: updateAvailable ? record.is_force_update : false,
            release_notes: updateAvailable ? record.release_notes : null,
            store_url: updateAvailable ? record.store_url : null,
        });
    } catch (err) {
        console.error("❌ checkVersion error:", err.message);
        return res.status(500).json({ message: "Internal server error." });
    }
};

// ─────────────────────────────────────────────
// POST /api/version/update  [Developer-only]
// Body: { platform, version, is_force_update, release_notes, store_url }
//
// Upserts the version record for the given platform.
// Called by the developer via Postman after each store release.
// ─────────────────────────────────────────────
const updateVersion = async (req, res) => {
    const { platform, version, is_force_update, release_notes, store_url } = req.body;

    if (!platform || !version) {
        return res.status(400).json({
            message: "Missing required fields: platform, version",
        });
    }

    const normalizedPlatform = platform.toLowerCase().trim();
    if (!["android", "ios"].includes(normalizedPlatform)) {
        return res.status(400).json({
            message: "Invalid platform. Must be 'android' or 'ios'.",
        });
    }

    // Basic semver format validation: X.Y.Z
    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(version.trim())) {
        return res.status(400).json({
            message: "Invalid version format. Use semver: X.Y.Z (e.g. 1.2.0)",
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO app_versions (platform, version, is_force_update, release_notes, store_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (platform)
       DO UPDATE SET
         version         = EXCLUDED.version,
         is_force_update = EXCLUDED.is_force_update,
         release_notes   = EXCLUDED.release_notes,
         store_url       = EXCLUDED.store_url,
         updated_at      = NOW()
       RETURNING *`,
            [
                normalizedPlatform,
                version.trim(),
                is_force_update ?? false,
                release_notes ?? null,
                store_url ?? null,
            ]
        );

        return res.status(200).json({
            message: `✅ Version updated successfully for platform: ${normalizedPlatform}`,
            data: result.rows[0],
        });
    } catch (err) {
        console.error("❌ updateVersion error:", err.message);
        return res.status(500).json({ message: "Internal server error." });
    }
};

module.exports = { checkVersion, updateVersion };
