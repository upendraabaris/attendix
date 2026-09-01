// deviceTokenCtrl.js
const pool = require("../configure/dbConfig");

/**
 * Register or update the caller's FCM device token (upsert by token)
 * @route POST /api/device-token
 * @access Private (Employee/Admin)
 */
const registerDeviceToken = async (req, res) => {
    const employeeId = req.user.employee_id;
    const { fcmToken, platform } = req.body;

    if (!fcmToken || typeof fcmToken !== "string") {
        return res.status(400).json({
            statusCode: 400,
            message: "fcmToken is required",
        });
    }

    const normalizedPlatform = String(platform || "").toLowerCase();
    if (!["ios", "android"].includes(normalizedPlatform)) {
        return res.status(400).json({
            statusCode: 400,
            message: "platform must be 'ios' or 'android'",
        });
    }

    try {
        const result = await pool.query(
            `
      INSERT INTO device_tokens (employee_id, fcm_token, platform, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (fcm_token)
      DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        platform = EXCLUDED.platform,
        updated_at = NOW()
      RETURNING *
      `,
            [employeeId, fcmToken, normalizedPlatform]
        );

        return res.status(200).json({
            statusCode: 200,
            message: "Device token registered successfully",
            data: result.rows[0],
        });
    } catch (error) {
        console.error("Error registering device token:", error.message);
        return res.status(500).json({
            statusCode: 500,
            message: "Failed to register device token",
            error: error.message,
        });
    }
};

module.exports = {
    registerDeviceToken,
};
