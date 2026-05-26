const pool = require("../configure/dbConfig");
const {
  getHolidayForDate,
  getWorkWeekPolicyByOrganization,
  isWeeklyOffAsPerPolicy,
} = require("./compOffService");
const { sendAutoAbsentEmail } = require("./emailService");

const ABSENT_LEAVE_TYPE = "unpaid";
const ABSENT_REASON = "Absent";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const toDateOnly = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const getISTDate = (date = new Date()) => {
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return istDate.toISOString().slice(0, 10);
};

const getPreviousDate = (dateOnly) => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const getAutoAbsentSetting = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT id, organization_id, is_enabled, last_processed_date, created_at, updated_at
      FROM auto_absent_settings
      WHERE organization_id = $1
      LIMIT 1
    `,
    [organizationId]
  );

  return (
    result.rows[0] || {
      id: null,
      organization_id: Number(organizationId),
      is_enabled: false,
      last_processed_date: null,
      created_at: null,
      updated_at: null,
    }
  );
};

const upsertAutoAbsentSetting = async (organizationId, payload = {}) => {
  const isEnabled =
    typeof payload.is_enabled === "boolean"
      ? payload.is_enabled
      : typeof payload.isEnabled === "boolean"
        ? payload.isEnabled
        : false;

  const result = await pool.query(
    `
      INSERT INTO auto_absent_settings (organization_id, is_enabled, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (organization_id)
      DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        updated_at = NOW()
      RETURNING id, organization_id, is_enabled, last_processed_date, created_at, updated_at
    `,
    [organizationId, isEnabled]
  );

  return result.rows[0];
};

const isHolidayOrWeeklyOff = async (organizationId, workDate) => {
  const holiday = await getHolidayForDate(organizationId, workDate);
  if (holiday) {
    return { isOff: true, reason: "holiday", holiday };
  }

  const policy = await getWorkWeekPolicyByOrganization(organizationId);
  if (isWeeklyOffAsPerPolicy(workDate, policy?.policy_name, policy?.policy_start_date)) {
    return { isOff: true, reason: "weekly_off", policy };
  }

  return { isOff: false, reason: null, policy };
};

const getActiveEmployeesByOrganization = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT e.id, e.name, u.email, o.name AS organization_name
      FROM employees e
      LEFT JOIN users u ON e.id = u.employee_id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.organization_id = $1
      AND COALESCE(e.status,'active') = 'active'
      AND LOWER(e.role) != 'admin'
      ORDER BY e.id ASC
    `,
    [organizationId]
  );

  return result.rows;
};

const hasClockInForDate = async (employeeId, workDate) => {
  const result = await pool.query(
    `
      SELECT 1
      FROM get_particular_attendance($1, $2::date, $2::date)
      WHERE clock_in IS NOT NULL
      LIMIT 1
    `,
    [employeeId, workDate]
  );

  return result.rows.length > 0;
};

const hasLeaveForDate = async (employeeId, workDate) => {
  const result = await pool.query(
    `
      SELECT 1
      FROM leave_requests
      WHERE employee_id = $1
        AND status != 'rejected'
        AND $2::date BETWEEN start_date AND end_date
      LIMIT 1
    `,
    [employeeId, workDate]
  );

  return result.rows.length > 0;
};

const createAbsentLeave = async (employeeId, workDate) => {
  const result = await pool.query(
    `
      INSERT INTO leave_requests (employee_id, type, start_date, end_date, reason)
      VALUES ($1, $2, $3::date, $3::date, $4)
      RETURNING id, employee_id, type, start_date, end_date, reason, status, created_at
    `,
    [employeeId, ABSENT_LEAVE_TYPE, workDate, ABSENT_REASON]
  );

  return result.rows[0] || null;
};

const getAdminEmailForOrganization = async (organizationId) => {
  const result = await pool.query(
    `
      SELECT u.email AS admin_email
      FROM organizations o
      JOIN employees e ON e.organization_id = o.id
      JOIN users u ON u.employee_id = e.id
      WHERE o.id = $1
        AND e.role = 'admin'
        AND e.status = 'active'
        AND u.email IS NOT NULL
      ORDER BY e.id ASC
      LIMIT 1
    `,
    [organizationId]
  );
  return result.rows[0]?.admin_email || null;
};

const processAutoAbsentForOrganization = async (organizationId, workDateInput) => {
  const workDate = toDateOnly(workDateInput);
  if (!workDate) {
    throw new Error("Valid workDate is required");
  }

  const setting = await getAutoAbsentSetting(organizationId);
  if (!setting.is_enabled) {
    return {
      organization_id: Number(organizationId),
      work_date: workDate,
      skipped: true,
      reason: "disabled",
      created_count: 0,
      skipped_count: 0,
      errors: [],
    };
  }

  const offDay = await isHolidayOrWeeklyOff(organizationId, workDate);
  if (offDay.isOff) {
    await markOrganizationProcessed(organizationId, workDate);
    return {
      organization_id: Number(organizationId),
      work_date: workDate,
      skipped: true,
      reason: offDay.reason,
      created_count: 0,
      skipped_count: 0,
      errors: [],
    };
  }

  const employees = await getActiveEmployeesByOrganization(organizationId);
  const adminEmail = await getAdminEmailForOrganization(organizationId);
  const errors = [];
  let createdCount = 0;
  let skippedCount = 0;

  for (const employee of employees) {
    try {
      const [clockedIn, existingLeave] = await Promise.all([
        hasClockInForDate(employee.id, workDate),
        hasLeaveForDate(employee.id, workDate),
      ]);

      if (clockedIn || existingLeave) {
        skippedCount += 1;
        continue;
      }

      await createAbsentLeave(employee.id, workDate);
      createdCount += 1;

      console.log(`Debug AutoAbsent: Employee ${employee.name} (ID: ${employee.id}), Email: ${employee.email}`);

      // Send auto absent email to employee
      if (employee.email) {
        sendAutoAbsentEmail({
          employeeEmail: employee.email,
          adminEmail: adminEmail,
          employeeName: employee.name,
          organizationName: employee.organization_name || 'Attendix',
          workDate: workDate
        }).catch(err => console.error("Auto-absent email failed:", err.message));
      }
    } catch (error) {
      errors.push({
        employee_id: employee.id,
        employee_name: employee.name,
        message: error.message,
      });
    }
  }

  await markOrganizationProcessed(organizationId, workDate);

  return {
    organization_id: Number(organizationId),
    work_date: workDate,
    skipped: false,
    created_count: createdCount,
    skipped_count: skippedCount,
    error_count: errors.length,
    errors,
  };
};

const markOrganizationProcessed = async (organizationId, workDate) => {
  await pool.query(
    `
      INSERT INTO auto_absent_settings (organization_id, is_enabled, last_processed_date, updated_at)
      VALUES ($1, true, $2::date, NOW())
      ON CONFLICT (organization_id)
      DO UPDATE SET
        last_processed_date = GREATEST(
          COALESCE(auto_absent_settings.last_processed_date, $2::date),
          $2::date
        ),
        updated_at = NOW()
    `,
    [organizationId, workDate]
  );
};

const getEnabledOrganizationsDueForAutoAbsent = async (workDate) => {
  const result = await pool.query(
    `
      SELECT organization_id
      FROM auto_absent_settings
      WHERE is_enabled = true
        AND (
          last_processed_date IS NULL
          OR last_processed_date < $1::date
        )
      ORDER BY organization_id ASC
    `,
    [workDate]
  );

  return result.rows.map((row) => row.organization_id);
};

const processDueAutoAbsent = async (date = new Date()) => {
  const todayIST = getISTDate(date);
  const targetDate = getPreviousDate(todayIST);
  const organizationIds = await getEnabledOrganizationsDueForAutoAbsent(targetDate);
  const results = [];

  for (const organizationId of organizationIds) {
    try {
      results.push(await processAutoAbsentForOrganization(organizationId, targetDate));
    } catch (error) {
      results.push({
        organization_id: Number(organizationId),
        work_date: targetDate,
        skipped: false,
        created_count: 0,
        skipped_count: 0,
        error_count: 1,
        errors: [{ message: error.message }],
      });
    }
  }

  return {
    work_date: targetDate,
    organization_count: organizationIds.length,
    results,
  };
};

const startAutoAbsentScheduler = () => {
  const run = async () => {
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);
    const istHour = istNow.getUTCHours();

    if (istHour !== 0) return;

    try {
      const result = await processDueAutoAbsent(now);
      if (result.organization_count > 0) {
        console.log(
          `Auto absent processed for ${result.organization_count} organization(s) on ${result.work_date}`
        );
      }
    } catch (error) {
      console.error("Auto absent scheduler failed:", error.message);
    }
  };

  setTimeout(run, 5000);
  return setInterval(run, 15 * 60 * 1000);
};

// const startAutoAbsentScheduler = () => {
//   const run = async () => {
//     const now = new Date();
//     const istNow = new Date(
//       now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
//     );

//     const hour = istNow.getHours();
//     const minutes = istNow.getMinutes();

//     // ✅ 3:42 PM se 3:49 PM tak (safe window)
//     if (!(hour === 12 && minutes >= 41 && minutes < 49)) return;

//     try {
//       const result = await processDueAutoAbsent(now);
//       console.log("Auto absent executed", result);
//     } catch (error) {
//       console.error(error);
//     }
//   };

//   setInterval(run, 60 * 1000); // every 1 minute
// };

module.exports = {
  ABSENT_LEAVE_TYPE,
  ABSENT_REASON,
  getAutoAbsentSetting,
  upsertAutoAbsentSetting,
  processAutoAbsentForOrganization,
  processDueAutoAbsent,
  startAutoAbsentScheduler,
};
