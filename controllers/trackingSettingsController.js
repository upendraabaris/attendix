const pool = require("../configure/dbConfig");

// ==========================================
// GET TRACKING SETTINGS
// ==========================================
const getTrackingSettings = async (req, res) => {

    try {

        const organizationId =
            req.user.organization_id;

        const result = await pool.query(
            `
    SELECT ts.*, e.name as updated_by_name
    FROM attendance_tracking_settings ts
    LEFT JOIN employees e ON ts.updated_by = e.id
    WHERE ts.organization_id = $1
    LIMIT 1
    `,
            [organizationId]
        );

        // if not found
        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message:
                    "Tracking settings not found"
            });
        }

        return res.status(200).json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {

        console.log(
            "Get Tracking Settings Error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to fetch tracking settings"
        });
    }
};

// ==========================================
// UPDATE TRACKING SETTINGS
// ==========================================
const updateTrackingSettings = async (
    req,
    res
) => {

    try {

        const organizationId =
            req.user.organization_id;

        const updatedBy =
            req.user.user_id;

        const {
            tracking_enabled,
            idle_warning_minutes,
            auto_clockout_minutes,
            break_enabled,
            max_break_minutes
        } = req.body;

        // check existing
        const existing =
            await pool.query(
                `
                SELECT id
                FROM attendance_tracking_settings
                WHERE organization_id = $1
                LIMIT 1
                `,
                [organizationId]
            );

        // ======================================
        // UPDATE EXISTING
        // ======================================
        if (existing.rows.length > 0) {

            await pool.query(
                `
                UPDATE attendance_tracking_settings
                SET
                    tracking_enabled = $1,

                    idle_warning_minutes = $2,

                    auto_clockout_minutes = $3,

                    break_enabled = $4,

                    max_break_minutes = $5,

                    updated_at = NOW(),

                    updated_by = $6

                WHERE organization_id = $7
                `,
                [
                    tracking_enabled,
                    idle_warning_minutes,
                    auto_clockout_minutes,
                    break_enabled,
                    max_break_minutes,
                    updatedBy,
                    organizationId
                ]
            );

            return res.status(200).json({
                success: true,
                message:
                    "Tracking settings updated successfully"
            });
        }

        // ======================================
        // INSERT NEW
        // ======================================
        await pool.query(
            `
            INSERT INTO attendance_tracking_settings (

                organization_id,

                tracking_enabled,

                idle_warning_minutes,

                auto_clockout_minutes,

                break_enabled,

                max_break_minutes,

                created_by,

                updated_by

            )

            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8
            )
            `,
            [
                organizationId,
                tracking_enabled,
                idle_warning_minutes,
                auto_clockout_minutes,
                break_enabled,
                max_break_minutes,
                updatedBy,
                updatedBy
            ]
        );

        return res.status(201).json({
            success: true,
            message:
                "Tracking settings created successfully"
        });

    } catch (error) {

        console.log(
            "Update Tracking Settings Error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to update tracking settings"
        });
    }
};

module.exports = {
    getTrackingSettings,
    updateTrackingSettings
};