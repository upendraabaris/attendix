const pool = require("../configure/dbConfig");

// -----------------------------------
// START BREAK
// -----------------------------------
const startBreak = async (req, res) => {

    try {

        const employeeId =
            req.user.employee_id;

        // CHECK ACTIVE BREAK
        const activeBreak =
            await pool.query(
                `
                SELECT *
                FROM employee_breaks
                WHERE employee_id = $1
                AND is_active = true
                `,
                [employeeId]
            );

        if (
            activeBreak.rows.length > 0
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Break already active"
            });
        }

        // CREATE BREAK
        const result =
            await pool.query(
                `
                INSERT INTO employee_breaks (
                    employee_id,
                    break_start,
                    is_active
                )
                VALUES (
                    $1,
                    NOW(),
                    true
                )
                RETURNING *
                `,
                [employeeId]
            );

        res.status(200).json({
            success: true,
            message:
                "Break started successfully",
            data: result.rows[0]
        });

    } catch (error) {

        console.log(
            "Start Break Error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Failed to start break"
        });
    }
};

// -----------------------------------
// END BREAK
// -----------------------------------
const endBreak = async (req, res) => {

    try {

        const employeeId =
            req.user.employee_id;

        // CHECK ACTIVE BREAK
        const activeBreak =
            await pool.query(
                `
                SELECT *
                FROM employee_breaks
                WHERE employee_id = $1
                AND is_active = true
                `,
                [employeeId]
            );

        if (
            activeBreak.rows.length === 0
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "No active break found"
            });
        }

        // END BREAK
        const result =
            await pool.query(
                `
                UPDATE employee_breaks
                SET
                    break_end = NOW(),
                    is_active = false
                WHERE employee_id = $1
                AND is_active = true
                RETURNING *
                `,
                [employeeId]
            );

        res.status(200).json({
            success: true,
            message:
                "Break ended successfully",
            data: result.rows[0]
        });

    } catch (error) {

        console.log(
            "End Break Error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Failed to end break"
        });
    }
};

const getEmployeeBreakHistory = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;

        const result = await pool.query(
            `SELECT 
        id,
        TO_CHAR(break_start AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY') as break_date,
        TO_CHAR(break_start AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH12:MI:SS AM') as break_start_time,
        TO_CHAR(break_end AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH12:MI:SS AM') as break_end_time,
        is_active,
        (EXTRACT(EPOCH FROM (break_end - break_start))/60)::integer as duration_minutes
     FROM employee_breaks
     WHERE employee_id = $1
       AND (break_start AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date
     ORDER BY break_start DESC`,
            [employeeId, startDate, endDate]
        );

        res.status(200).json({
            success: true,
            data: result.rows
        });
    } catch (error) {
        console.error("Fetch Break History Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch break history" });
    }
};


module.exports = {
    startBreak,
    endBreak,
    getEmployeeBreakHistory
};