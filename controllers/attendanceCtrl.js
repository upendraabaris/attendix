const pool = require("../configure/dbConfig");
const { reverseGeocode, reverseGeocodeGoogle } = require('../services/geocodingService');
const { syncEarnedLeaveBalanceForEmployee } = require("../services/leaveBalanceService");
const { earnCompOff } = require("../services/compOffService");


const formatToIST = (utcDateTimeString) => {
  if (!utcDateTimeString) return "–";

  const utcDate = new Date(utcDateTimeString);
  const istDate = new Date(utcDate.getTime() + 5.5 * 60 * 60 * 1000);

  return istDate.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const clockIn = async (req, res) => {
  const { latitude, longitude } = req.body;
  const employeeId = req.user.employee_id;

  try {
    // Get address from coordinates
    let address = await reverseGeocodeGoogle(latitude, longitude);
    // console.log(address);

    // Call the PostgreSQL function to clock in
    const result = await pool.query(
      'SELECT * FROM clock_in($1, $2, $3, $4)',
      [employeeId, latitude, longitude, address]
    );

    res.status(201).json({
      statusCode: 201,
      message: 'Clock in successful',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error clocking in:', error);
    res.status(500).json({
      statusCode: 500,
      message: error.message || 'Failed to clock in',
      error: error.message
    });
  }
};

const clockOut = async (req, res) => {
  const { latitude, longitude } = req.body;
  const employeeId = req.user.employee_id;
  console.log(employeeId)

  try {
    // Get address from coordinates
    let address = await reverseGeocodeGoogle(latitude, longitude);

    // Call the PostgreSQL function to clock out
    const result = await pool.query(
      'SELECT * FROM clock_out($1, $2, $3, $4)',
      [employeeId, latitude, longitude, address]
    );

    // Non-blocking earned leave sync based on present/working days.
    try {
      await syncEarnedLeaveBalanceForEmployee(employeeId, 'earned');
    } catch (earnedSyncError) {
      console.error("Earned leave sync failed:", earnedSyncError.message);
    }


    // Non-blocking earned leave sync based on present/working days.
    try {
      await syncEarnedLeaveBalanceForEmployee(employeeId, 'casual');
    } catch (earnedSyncError) {
      console.error("Casual leave sync failed:", earnedSyncError.message);
    }

    try {
      await earnCompOff({
        employeeId,
        organizationId: req.user.organization_id,
        workDate: getISTDate(),
      });
    } catch (compOffError) {
      console.error("Comp off earn sync failed:", compOffError.message);
    }

    res.status(200).json({
      statusCode: 200,
      message: 'Clock out successful',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error clocking out:', error);
    res.status(500).json({
      statusCode: 500,
      message: error.message || 'Failed to clock out',
      error: error.message
    });
  }
};
const getISTDate = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().split('T')[0];
};

const getMyAttendance = async (req, res) => {
  const employeeId = req.user.employee_id;
  const { startDate, endDate } = req.query;

  const today = getISTDate();
  const start = startDate || today;
  const end = endDate || today;

  try {
    const result = await pool.query(
      'SELECT * FROM get_employee_attendance($1, $2, $3)',
      [employeeId, start, end]
    );

    const formattedRows = result.rows.map((row) => {
      const istDate = new Date(row.timestamp);
      istDate.setMinutes(istDate.getMinutes() + 330); // Convert to IST (UTC+5:30)

      return {
        ...row,
        date: istDate.toLocaleDateString('en-US', {
          month: 'short', // "Aug"
          day: 'numeric', // "12"
          year: 'numeric' // "2025"
        }), // "Aug 12, 2025"
        time: istDate.toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }) // "10:03 AM"
      };
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Attendance records retrieved successfully',
      data: formattedRows
    });

  } catch (error) {
    console.error('Error retrieving attendance:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve attendance records',
      error: error.message
    });
  }
};

const getEmployeeAttendance = async (req, res) => {
  const { employeeId } = req.user.employee_id;
  const { startDate, endDate } = req.query;

  // Default to current month if dates not provided
  const start = startDate || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      'SELECT * FROM get_employee_attendance($1, $2, $3)',
      [employeeId, start, end]
    );

    res.status(200).json({
      statusCode: 200,
      message: 'Attendance records retrieved successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('Error retrieving attendance:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve attendance records',
      error: error.message
    });
  }
};
const getAllAttendance = async (req, res) => {
  const { startDate, endDate, employeeId, organizationId } = req.query;

  const start = startDate || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const empId = employeeId && employeeId !== 'all' ? parseInt(employeeId) : 0;
    const orgId = organizationId ? parseInt(organizationId) : null;

    if (!orgId) {
      return res.status(400).json({
        statusCode: 400,
        message: 'Missing required parameter: organizationId'
      });
    }

    const result = await pool.query(
      'SELECT * FROM get_combined_attendance($1, $2, $3, $4)',
      [empId, start, end, orgId]
    );

    // ─── Fetch admin_remark directly from attendance table ───────────────────
    // get_combined_attendance is a stored function created before admin_remark
    // column was added, so it doesn't return it. We fetch it separately.
    let remarkMap = {}; // key: "YYYY-MM-DD-employeeId", value: admin_remark

    try {
      const remarkQuery = empId > 0
        ? `SELECT 
             employee_id,
             DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS work_date,
             admin_remark
           FROM attendance
           WHERE type = 'out'
             AND admin_remark IS NOT NULL
             AND employee_id = $1
             AND DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') BETWEEN $2 AND $3`
        : `SELECT 
             a.employee_id,
             DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::text AS work_date,
             a.admin_remark
           FROM attendance a
           JOIN employees e ON a.employee_id = e.id
           WHERE a.type = 'out'
             AND a.admin_remark IS NOT NULL
             AND e.organization_id = $1
             AND DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') BETWEEN $2 AND $3`;

      const remarkParams = empId > 0
        ? [empId, start, end]
        : [orgId, start, end];

      const remarkResult = await pool.query(remarkQuery, remarkParams);
      remarkResult.rows.forEach(r => {
        remarkMap[`${r.work_date}-${r.employee_id}`] = r.admin_remark;
      });
    } catch (remarkErr) {
      // If admin_remark column doesn't exist yet, silently ignore
      console.warn('Could not fetch admin_remark (column may not exist yet):', remarkErr.message);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const updatedRows = result.rows.map((row) => {
      const inTime = row.clock_in ? new Date(new Date(row.clock_in).getTime() + 330 * 60 * 1000) : null;
      const outTime = row.clock_out ? new Date(new Date(row.clock_out).getTime() + 330 * 60 * 1000) : null;

      let workedTime = 'Missing Clock Out';

      if (inTime && outTime) {
        const diffMs = outTime - inTime;
        if (diffMs > 0) {
          const hrs = Math.floor(diffMs / (1000 * 60 * 60));
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          workedTime = `${hrs}h ${mins}m`;
        } else {
          workedTime = 'Invalid time (Out before In)';
        }
      }

      const dateStr = inTime?.toISOString().split('T')[0] || null;
      const empIdForRow = row.employee_id || empId;
      const adminRemark = dateStr ? (remarkMap[`${dateStr}-${empIdForRow}`] || null) : null;

      return {
        ...row,
        raw_clock_in: row.clock_in,
        raw_clock_out: row.clock_out,
        clock_in: inTime?.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        clock_out: outTime?.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        worked_time: workedTime,
        date: dateStr,
        admin_remark: adminRemark
      };
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Attendance records retrieved successfully',
      data: updatedRows
    });
  } catch (error) {
    console.error('Error retrieving attendance:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve attendance records',
      error: error.message
    });
  }
};

const getAttendanceByAdmin = async (req, res) => {
  const employeeId = req.body.employeeId;
  const { startDate, endDate } = req.query;

  const today = getISTDate();
  const start = startDate || today;
  const end = endDate || today;

  try {
    const result = await pool.query(
      'SELECT * FROM get_employee_attendance($1, $2, $3)',
      [employeeId, start, end]
    );

    const formattedRows = result.rows.map((row) => {
      const istDate = new Date(row.timestamp);
      istDate.setMinutes(istDate.getMinutes() + 330); // Convert to IST (UTC+5:30)

      return {
        ...row,
        date: istDate.toLocaleDateString('en-US', {
          month: 'short', // "Aug"
          day: 'numeric', // "12"
          year: 'numeric' // "2025"
        }), // "Aug 12, 2025"
        time: istDate.toLocaleTimeString('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }) // "10:03 AM"
      };
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Attendance records retrieved successfully',
      data: formattedRows
    });

  } catch (error) {
    console.error('Error retrieving attendance:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve attendance records',
      error: error.message
    });
  }
};

const getParticularAttendance = async (req, res) => {
  const { startDate, endDate, employeeId } = req.query;

  // Default start: first day of current month, end: today
  const start = startDate || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const empId = employeeId && employeeId !== 'all' ? parseInt(employeeId) : 0;

    // ✅ Call the updated PostgreSQL function with 3 params
    const result = await pool.query(
      'SELECT * FROM get_particular_attendance($1, $2, $3)',
      [empId, start, end]
    );

    const updatedRows = result.rows.map((row) => {
      const inTime = row.clock_in ? new Date(new Date(row.clock_in).getTime() + 330 * 60 * 1000) : null;
      const outTime = row.clock_out ? new Date(new Date(row.clock_out).getTime() + 330 * 60 * 1000) : null;

      let workedTime = 'Missing Clock Out';

      if (inTime && outTime) {
        const diffMs = outTime - inTime;
        if (diffMs > 0) {
          const hrs = Math.floor(diffMs / (1000 * 60 * 60));
          const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          workedTime = `${hrs}h ${mins}m`;
        } else {
          workedTime = 'Invalid time (Out before In)';
        }
      }

      return {
        ...row,
        raw_clock_in: row.clock_in,
        raw_clock_out: row.clock_out,
        clock_in: inTime?.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        clock_out: outTime?.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        worked_time: workedTime,
        // ✅ Change date format to "Aug 12, 2025"
        date: inTime?.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        }) || null
      };
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Attendance records retrieved successfully',
      data: updatedRows
    });
  } catch (error) {
    console.error('Error retrieving attendance:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve attendance records',
      error: error.message
    });
  }
};



/**
 * Admin can manually set a clock-out time + remark for a missing clock-out
 * Body: { employeeId, workDate (YYYY-MM-DD), clockOutTime (HH:MM), remark }
 */
const adminUpdateClockOut = async (req, res) => {
  const { employeeId, workDate, clockOutTime, remark } = req.body;
  const organizationId = req.user.organization_id;

  if (!employeeId || !workDate || !clockOutTime) {
    return res.status(400).json({
      statusCode: 400,
      message: 'employeeId, workDate, and clockOutTime are required'
    });
  }

  try {
    // Verify employee belongs to this organization
    const empCheck = await pool.query(
      `SELECT id FROM employees WHERE id = $1 AND organization_id = $2`,
      [employeeId, organizationId]
    );
    if (empCheck.rows.length === 0) {
      return res.status(403).json({ statusCode: 403, message: 'Employee not found in your organization' });
    }

    // Check if a clock-in exists for this date
    const clockInCheck = await pool.query(
      `SELECT id FROM attendance 
       WHERE employee_id = $1 
         AND type = 'in' 
         AND DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $2`,
      [employeeId, workDate]
    );
    if (clockInCheck.rows.length === 0) {
      return res.status(400).json({ statusCode: 400, message: 'No clock-in record found for this date' });
    }

    // Check if clock-out already exists for this date
    const clockOutCheck = await pool.query(
      `SELECT id FROM attendance 
       WHERE employee_id = $1 
         AND type = 'out' 
         AND DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $2`,
      [employeeId, workDate]
    );
    if (clockOutCheck.rows.length > 0) {
      return res.status(409).json({ statusCode: 409, message: 'Clock-out already exists for this date' });
    }

    // Build the timestamp: combine workDate + clockOutTime in IST, then convert to UTC for storage
    // clockOutTime format: "HH:MM"
    const [hours, minutes] = clockOutTime.split(':').map(Number);
    // Create a date in IST (UTC+5:30 = 330 min ahead)
    const istDate = new Date(`${workDate}T${clockOutTime}:00+05:30`);

    // Insert the clock-out record
    await pool.query(
      `INSERT INTO attendance (employee_id, type, timestamp, latitude, longitude, address, admin_remark)
       VALUES ($1, 'out', $2, 0, 0, 'Admin Updated', $3)`,
      [employeeId, istDate.toISOString(), remark || null]
    );

    res.status(200).json({
      statusCode: 200,
      message: 'Clock-out updated successfully by admin'
    });
  } catch (error) {
    // If admin_remark column doesn't exist, try without it
    if (error.message && error.message.includes('admin_remark')) {
      try {
        const [, ] = clockOutTime.split(':').map(Number);
        const istDate = new Date(`${workDate}T${clockOutTime}:00+05:30`);
        await pool.query(
          `INSERT INTO attendance (employee_id, type, timestamp, latitude, longitude, address)
           VALUES ($1, 'out', $2, 0, 0, $3)`,
          [employeeId, istDate.toISOString(), remark ? `Admin Updated | Remark: ${remark}` : 'Admin Updated']
        );
        return res.status(200).json({
          statusCode: 200,
          message: 'Clock-out updated successfully by admin'
        });
      } catch (innerError) {
        console.error('Admin Clock-Out Update Error (fallback):', innerError);
        return res.status(500).json({ statusCode: 500, message: 'Failed to update clock-out', error: innerError.message });
      }
    }
    console.error('Admin Clock-Out Update Error:', error);
    res.status(500).json({ statusCode: 500, message: 'Failed to update clock-out', error: error.message });
  }
};

module.exports = {
  clockIn,
  clockOut,
  getMyAttendance,
  getEmployeeAttendance,
  getAllAttendance,
  getAttendanceByAdmin,
  getParticularAttendance,
  adminUpdateClockOut
};
