// wfhCtrl.js
const pool = require("../configure/dbConfig");

const getRequestedDays = (startDate, endDate, isHalfDay) => {
    if (isHalfDay) return 0.5;
    return (
        Math.floor(
            (new Date(endDate).getTime() - new Date(startDate).getTime()) /
            (1000 * 60 * 60 * 24)
        ) + 1
    );
};

/**
 * Create a new WFH request
 * @route POST /api/wfh
 * @access Private (Employee)
 */
const createWFHRequest = async (req, res) => {
    const employeeId = req.user.employee_id;
    const organizationId = req.user.organization_id;
    const { startDate, endDate, reason, is_half_day } = req.body;
    const isHalfDay = is_half_day === true || is_half_day === "true";

    try {
        if (!startDate || !endDate) {
            return res.status(400).json({
                statusCode: 400,
                message: "Start date and end date are required",
            });
        }

        if (new Date(endDate) < new Date(startDate)) {
            return res.status(400).json({
                statusCode: 400,
                message: "End date cannot be before start date",
            });
        }

        if (!reason?.trim()) {
            return res.status(400).json({
                statusCode: 400,
                message: "Reason is required",
            });
        }

        if (!organizationId) {
            return res.status(400).json({
                statusCode: 400,
                message: "Organization ID missing in token",
            });
        }

        // Fetch employee name once, store it denormalized (no join needed later)
        let employeeName = `Employee #${employeeId}`;
        try {
            const empRes = await pool.query("SELECT name FROM employees WHERE id = $1", [employeeId]);
            if (empRes.rows[0]?.name) {
                employeeName = empRes.rows[0].name;
            }
        } catch (nameErr) {
            console.error("Could not resolve employee name for WFH request:", nameErr.message);
        }

        const result = await pool.query(
            `
      INSERT INTO wfh_requests (
        employee_id, employee_name, organization_id,
        start_date, end_date, reason, is_half_day,
        status, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())
      RETURNING *
      `,
            [employeeId, employeeName, organizationId, startDate, endDate, reason || null, isHalfDay]
        );

        return res.status(201).json({
            statusCode: 201,
            message: "WFH request submitted successfully",
            data: result.rows[0],
        });
    } catch (error) {
        console.error("Error creating WFH request:", error);
        return res.status(500).json({
            statusCode: 500,
            message: "Failed to submit WFH request",
            error: error.message,
        });
    }
};

/**
 * Get WFH requests for the logged-in employee
 * @route GET /api/wfh/my
 * @access Private (Employee)
 */
const getMyWFHRequests = async (req, res) => {
    const employeeId = req.user.employee_id;

    try {
        const result = await pool.query(
            `
      SELECT * FROM wfh_requests
      WHERE employee_id = $1
      ORDER BY created_at DESC
      `,
            [employeeId]
        );

        return res.status(200).json({
            statusCode: 200,
            message: "WFH requests retrieved successfully",
            data: result.rows,
        });
    } catch (error) {
        console.error("Error retrieving WFH requests:", error);
        return res.status(500).json({
            statusCode: 500,
            message: "Failed to retrieve WFH requests",
            error: error.message,
        });
    }
};

/**
 * Get all WFH requests for the org (admin only), no join needed
 * @route GET /api/wfh/get
 * @access Private (Admin)
 */
const getAllWFHRequests = async (req, res) => {
    const organizationId = req.user.organization_id;
    const { status, search } = req.query;

    try {
        const conditions = ["organization_id = $1"];
        const values = [organizationId];

        if (status && status !== "all") {
            values.push(status);
            conditions.push(`status = $${values.length}`);
        }
        if (search) {
            values.push(`%${search}%`);
            conditions.push(`employee_name ILIKE $${values.length}`);
        }

        const result = await pool.query(
            `
      SELECT * FROM wfh_requests
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      `,
            values
        );

        return res.status(200).json({
            statusCode: 200,
            message: "WFH requests retrieved successfully",
            data: result.rows,
        });
    } catch (error) {
        console.error("Error retrieving WFH requests:", error);
        return res.status(500).json({
            statusCode: 500,
            message: "Failed to retrieve WFH requests",
            error: error.message,
        });
    }
};

/**
 * Get only pending WFH requests (admin only)
 * @route GET /api/wfh/admin/wfh-requests/pending
 * @access Private (Admin)
 */
const getPendingWFHRequests = async (req, res) => {
    const organizationId = req.user.organization_id;

    try {
        const result = await pool.query(
            `
      SELECT * FROM wfh_requests
      WHERE organization_id = $1 AND status = 'pending'
      ORDER BY created_at DESC
      `,
            [organizationId]
        );

        return res.status(200).json({
            success: true,
            statusCode: 200,
            count: result.rows.length,
            message: "Pending WFH requests retrieved successfully",
            data: result.rows,
        });
    } catch (error) {
        console.error("Error retrieving pending WFH requests:", error);
        return res.status(500).json({
            success: false,
            statusCode: 500,
            message: "Failed to retrieve pending WFH requests",
            error: error.message,
        });
    }
};

/**
 * Update WFH request status (approve/reject)
 * @route PUT /api/wfh/update/:wfhId
 * @access Private (Admin)
 */
const updateWFHRequestStatus = async (req, res) => {
    const { wfhId } = req.params;
    const { status } = req.body;

    try {
        if (!status || !["approved", "rejected"].includes(status)) {
            return res.status(400).json({
                statusCode: 400,
                message: 'Status must be either "approved" or "rejected"',
            });
        }

        const result = await pool.query(
            `
      UPDATE wfh_requests
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
            [status, parseInt(wfhId)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                statusCode: 404,
                message: "WFH request not found or not updated",
            });
        }

        return res.status(200).json({
            statusCode: 200,
            message: `WFH request ${status}`,
            data: result.rows[0],
        });
    } catch (error) {
        console.error("Error updating WFH request:", error.message);
        return res.status(500).json({
            statusCode: 500,
            message: "Failed to update WFH request",
            error: error.message,
        });
    }
};

module.exports = {
    createWFHRequest,
    getMyWFHRequests,
    getAllWFHRequests,
    getPendingWFHRequests,
    updateWFHRequestStatus,
};