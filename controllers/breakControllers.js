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
const getTodayBreakStatus = async (req, res) => {
    try {
        const employeeId = req.user.employee_id;

        const result = await pool.query(
            `
      SELECT
        COALESCE(
          SUM(
            EXTRACT(
              EPOCH FROM (
                break_end - break_start
              )
            )
          ) FILTER (
            WHERE is_active = false
              AND break_end IS NOT NULL
          ),
          0
        )::integer AS total_break_seconds,

        COALESCE(
          BOOL_OR(is_active = true),
          false
        ) AS is_on_break,

        MAX(break_start) FILTER (
          WHERE is_active = true
        ) AS active_break_start

      FROM employee_breaks
      WHERE employee_id = $1
        AND (
          break_start AT TIME ZONE 'UTC'
          AT TIME ZONE 'Asia/Kolkata'
        )::date =
        (
          CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
        )::date
      `,
            [employeeId]
        );

        const data = result.rows[0];

        return res.status(200).json({
            success: true,
            message: "Today break status fetched successfully",
            data: {
                totalBreakSeconds: Number(
                    data.total_break_seconds || 0
                ),
                isOnBreak: Boolean(data.is_on_break),
                breakStart: data.active_break_start || null,
            },
        });
    } catch (error) {
        console.error("Get Today Break Status Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch today break status",
        });
    }
};

// -----------------------------------
// GET ATTENDANCE BREAK SUMMARY
// -----------------------------------
const getAttendanceBreakSummary = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;

        if (!employeeId) {
            return res.status(400).json({ success: false, message: "Employee ID is required" });
        }

        const start = startDate || new Date(new Date().setDate(1)).toISOString().split('T')[0];
        const end = endDate || new Date().toISOString().split('T')[0];

        const result = await pool.query(
            `SELECT 
                id,
                break_start,
                break_end,
                is_active,
                TO_CHAR(break_start AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') as break_date,
                ROUND(EXTRACT(EPOCH FROM (COALESCE(break_end, NOW()) - break_start)))::integer as duration_seconds
             FROM employee_breaks
             WHERE employee_id = $1
               AND (break_start AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date
             ORDER BY break_start ASC`,
            [employeeId, start, end]
        );

        const formatSeconds = (totalSecs) => {
            const secs = Math.max(0, Math.floor(totalSecs));
            const hrs = Math.floor(secs / 3600);
            const mins = Math.floor((secs % 3600) / 60);
            const remainingSecs = secs % 60;

            const parts = [];
            if (hrs > 0) parts.push(`${hrs}h`);
            if (mins > 0 || hrs > 0) parts.push(`${mins}m`);
            parts.push(`${remainingSecs}s`);
            return parts.join(" ");
        };

        const summaryMap = {};
        result.rows.forEach(row => {
            const secs = parseInt(row.duration_seconds) || 0;
            if (!summaryMap[row.break_date]) {
                summaryMap[row.break_date] = { total_seconds: 0, formatted: "0s" };
            }
            summaryMap[row.break_date].total_seconds += secs;
        });

        Object.keys(summaryMap).forEach(d => {
            const secs = summaryMap[d].total_seconds;
            summaryMap[d].formatted = formatSeconds(secs);
        });

        const processedBreaks = result.rows.map(row => {
            const bStart = row.break_start ? new Date(new Date(row.break_start).getTime() + 330 * 60 * 1000).toISOString() : null;
            const bEnd = row.break_end ? new Date(new Date(row.break_end).getTime() + 330 * 60 * 1000).toISOString() : null;
            return {
                ...row,
                break_start: bStart,
                break_end: bEnd
            };
        });

        res.status(200).json({
            success: true,
            data: summaryMap,
            breaks: processedBreaks
        });
    } catch (error) {
        console.error("Fetch Attendance Break Summary Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch break summary" });
    }
};

module.exports = {
    startBreak,
    endBreak,
    getEmployeeBreakHistory,
    getTodayBreakStatus,
    getAttendanceBreakSummary
};