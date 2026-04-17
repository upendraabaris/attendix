const pool = require("../configure/dbConfig");
const { getWorkWeekPolicyByOrganization } = require("../services/compOffService");

// Helper to get YYYY-MM-DD in local time
const toDateString = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/**
 * Helper to check if a date is a weekend based on policy
 */
const isWeekendByPolicy = (date, policy) => {
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    const policyName = policy?.policy_name;

    // Sunday is always off in all current policies
    if (day === 0) return true;

    // Check Saturday based on policy
    if (day === 6) {
        if (policyName === "all_saturday_and_sunday_off") return true;

        const dateNum = date.getDate();
        const occurrence = Math.ceil(dateNum / 7); // 1st, 2nd, etc. Saturday

        if (policyName === "second_and_fourth_saturday_and_every_sunday_off") {
            return occurrence === 2 || occurrence === 4;
        }

        if (policyName === "alternate_saturday_and_every_sunday_off") {
            // Logic matches your compOffService.js pattern
            if (!policy.policy_start_date) return occurrence % 2 === 1;
            const startDate = new Date(policy.policy_start_date);
            const diffDays = Math.floor((date - startDate) / (1000 * 60 * 60 * 24));
            return diffDays % 14 === 0;
        }
    }
    return false;
};

const generateAttendanceReport = async (req, res) => {
    const { startDate, endDate } = req.query;
    const organizationId = req.user.organization_id;

    if (!startDate || !endDate) {
        return res.status(400).json({ statusCode: 400, message: "Date range is required" });
    }

    try {
        // 1. Fetch Organization Policy & Holidays
        const policy = await getWorkWeekPolicyByOrganization(organizationId);
        const holidaysResult = await pool.query(
            "SELECT holiday_date::text FROM holidays WHERE organization_id = $1 AND holiday_date BETWEEN $2 AND $3",
            [organizationId, startDate, endDate]
        );
        const holidayDates = new Set(holidaysResult.rows.map(h => h.holiday_date));

        // 2. Fetch All Active Employees for the Organization
        const employeesResult = await pool.query(
            "SELECT id, name FROM employees WHERE organization_id = $1 AND status = 'active' AND role != 'admin'",
            [organizationId]
        );
        const employees = employeesResult.rows;

        // 3. Global KPI Calculation (Total range)
        let totalHolidays = 0;
        let totalWeekendOffs = 0;
        let totalWorkingDays = 0;

        const start = new Date(startDate);
        const end = new Date(endDate);
        const daysInRange = [];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = toDateString(d);
            const isWeekend = isWeekendByPolicy(new Date(d), policy);
            const isHoliday = holidayDates.has(dateStr);

            if (isWeekend) totalWeekendOffs++;
            else if (isHoliday) totalHolidays++;
            else totalWorkingDays++;

            daysInRange.push(dateStr);
        }

        // 4. Fetch Attendance Records for all employees in batch
        // We join with employees because the attendance table itself doesn't have organization_id
        const attendanceResult = await pool.query(
            `SELECT 
                a.employee_id, 
                DATE(a.timestamp)::text as work_date 
             FROM attendance a
             JOIN employees e ON a.employee_id = e.id
             WHERE e.organization_id = $1
               AND a.type = 'in'
               AND DATE(a.timestamp) BETWEEN $2 AND $3`,
            [organizationId, startDate, endDate]
        );

        // Group attendance by employee
        const attendanceMap = {};
        attendanceResult.rows.forEach(row => {
            const empId = row.employee_id;
            const dateStr = row.work_date; // already a string from ::text
            if (!attendanceMap[empId]) attendanceMap[empId] = new Set();
            attendanceMap[empId].add(dateStr);
        });

        // 5. Fetch Approved Leave Requests for the Organization
        const leavesResult = await pool.query(
            `SELECT 
                employee_id, start_date, end_date 
             FROM leave_requests 
             WHERE status = 'approved'
               AND employee_id IN (SELECT id FROM employees WHERE organization_id = $1)
               AND (start_date <= $3 AND end_date >= $2)`,
            [organizationId, startDate, endDate]
        );

        // Group leaves by employee and calculate overlapping days
        const leavesMap = {};
        leavesResult.rows.forEach(row => {
            const empId = row.employee_id;

            // Calculate overlap between [startDate, endDate] and [row.start_date, row.end_date]
            const overlapStart = new Date(Math.max(new Date(startDate), new Date(row.start_date)));
            const overlapEnd = new Date(Math.min(new Date(endDate), new Date(row.end_date)));

            const diffMs = overlapEnd - overlapStart;
            const overlapDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);

            if (!leavesMap[empId]) leavesMap[empId] = 0;
            leavesMap[empId] += overlapDays;
        });

        // 6. Build Employee Breakdown
        const employeeRows = employees.map(emp => {
            const presentDaysCount = attendanceMap[emp.id] ? attendanceMap[emp.id].size : 0;
            const leaveDaysCount = leavesMap[emp.id] || 0;

            return {
                name: emp.name,
                workingDays: presentDaysCount,
                leaves: leaveDaysCount,
                holidays: totalHolidays
            };
        });

        res.status(200).json({
            statusCode: 200,
            message: "Report generated successfully",
            data: {
                summary: {
                    workingDays: totalWorkingDays,
                    holidays: totalHolidays,
                    weekendOffs: totalWeekendOffs,
                    totalLeaves: Object.values(leavesMap).reduce((a, b) => a + b, 0)
                },
                rows: employeeRows
            }
        });

    } catch (error) {
        console.error("Report Generation Error:", error);
        res.status(500).json({ statusCode: 500, message: "Failed to generate report", error: error.message });
    }
};

module.exports = { generateAttendanceReport };
