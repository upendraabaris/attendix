const pool = require("../configure/dbConfig");
const { sendNewLeaveRequestEmail, sendLeaveStatusEmail } = require("../services/emailService");
const { validateLeaveRequestAgainstPolicy } = require("../services/leavePolicyService");
const { syncEarnedLeaveBalanceForEmployee } = require("../services/leaveBalanceService");
const { getEmployeeLeaveBalances } = require("../services/leaveBalanceService");
const { uploadToS3 } = require("../services/s3Uploader");

const getRequestedDays = (startDate, endDate) =>
  Math.floor(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) /
    (1000 * 60 * 60 * 24)
  ) + 1;

const getSickDocumentDaysRequired = async (employeeId) => {
  const result = await pool.query(
    `
      SELECT lp.document_days_required
      FROM employees e
      LEFT JOIN leave_policies lp
        ON lp.organization_id = e.organization_id
       AND lp.leave_type = 'sick'
      WHERE e.id = $1
      LIMIT 1
    `,
    [employeeId]
  );

  return Number(result.rows[0]?.document_days_required ?? 0);
};

const buildAttachmentUrl = (req, attachmentPath) => {
  if (!attachmentPath) {
    return null;
  }

  // If it's already a full S3 URL, return it as is
  if (attachmentPath.startsWith("http")) {
    return attachmentPath;
  }

  return `${req.protocol}://${req.get("host")}${attachmentPath.replace(/\\/g, "/")}`;
};

const saveLeaveAttachment = async ({ leaveId, employeeId, file }) => {
  if (!leaveId || !file) {
    return null;
  }

  // Upload file to AWS S3
  const s3Url = await uploadToS3(file);

  const result = await pool.query(
    `
      INSERT INTO leave_attachments (
        leave_id,
        employee_id,
        file_name,
        file_path,
        mime_type,
        file_size
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [leaveId, employeeId, file.originalname, s3Url, file.mimetype, file.size]
  );

  return result.rows[0] || null;
};

const attachLeaveAttachments = async (req, rows = []) => {
  if (!rows.length) {
    return rows;
  }

  const leaveIds = rows
    .map((row) => row.leave_id || row.id)
    .filter(Boolean);

  if (!leaveIds.length) {
    return rows;
  }

  const result = await pool.query(
    `
      SELECT leave_id, file_name, file_path, mime_type, file_size
      FROM leave_attachments
      WHERE leave_id = ANY($1::int[])
      ORDER BY id DESC
    `,
    [leaveIds]
  );

  const attachmentMap = result.rows.reduce((acc, row) => {
    if (!acc[row.leave_id]) {
      acc[row.leave_id] = row;
    }
    return acc;
  }, {});

  return rows.map((row) => {
    const leaveId = row.leave_id || row.id;
    const attachment = attachmentMap[leaveId];

    return {
      ...row,
      medical_proof_name: attachment?.file_name || null,
      medical_proof_url: buildAttachmentUrl(req, attachment?.file_path || null),
      medical_proof_mime_type: attachment?.mime_type || null,
      medical_proof_size: attachment?.file_size || null,
    };
  });
};

const createLeaveRequest = async (req, res) => {
  const { type, startDate, endDate, reason, is_half_day } = req.body;
  const isHalfDay = is_half_day === true || is_half_day === 'true';
  const employeeId = req.user.employee_id;
  const organizationId = req.user.organization_id;

  try {
    // Validate input
    if (!type || !startDate || !endDate) {
      return res.status(400).json({
        statusCode: 400,
        message: 'Type, start date, and end date are required'
      });
    }

    if (new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({
        statusCode: 400,
        message: 'End date cannot be before start date'
      });
    }

    const requestedDays = getRequestedDays(startDate, endDate);
    const sickDocumentDaysRequired =
      type === "sick" ? await getSickDocumentDaysRequired(employeeId) : 0;

    if (type === "sick" && sickDocumentDaysRequired > 0 && requestedDays > sickDocumentDaysRequired && !req.file) {
      return res.status(400).json({
        statusCode: 400,
        message: `Medical proof is required for sick leave longer than ${sickDocumentDaysRequired} consecutive day${sickDocumentDaysRequired > 1 ? "s" : ""}`
      });
    }

    await validateLeaveRequestAgainstPolicy({
      employeeId,
      leaveType: type,
      startDate,
      endDate,
      isHalfDay
    });

    // Call the PostgreSQL function to create leave request
    const result = await pool.query(
      'SELECT * FROM create_leave_request($1, $2, $3, $4, $5, $6)',
      [employeeId, type, startDate, endDate, reason, false]
    );
    const createdLeave = result.rows[0] || null;
    const leaveId = createdLeave?.leave_id || createdLeave?.id || null;
    const attachment = await saveLeaveAttachment({
      leaveId,
      employeeId,
      file: req.file,
    });

    // Attempt to email the admin about the new leave request (non-blocking of API success)
    try {
      if (!organizationId) {
        throw new Error('Organization ID is missing in token');
      }

      const adminResult = await pool.query(
        `
        SELECT
          u.email AS admin_email,
          o.name AS organization_name
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

      if (!adminResult.rows.length) {
        throw new Error(`No active admin email found for organization ${organizationId}`);
      }

      const adminEmail = adminResult.rows[0].admin_email;
      const organizationName = adminResult.rows[0].organization_name || 'Attendix';
      // Prefer real employee name from DB to avoid sending the numeric ID
      let employeeName = null;
      try {
        const empRes = await pool.query('SELECT name FROM employees WHERE id = $1', [employeeId]);
        if (empRes.rows && empRes.rows[0] && empRes.rows[0].name) {
          employeeName = empRes.rows[0].name;
        }
      } catch (nameErr) {
        // fallback handled below
      }
      if (!employeeName) {
        employeeName = (req.user && (req.user.name || req.user.employee_name || req.user.fullName))
          ? (req.user.name || req.user.employee_name || req.user.fullName)
          : `Employee #${employeeId}`;
      }

      await sendNewLeaveRequestEmail({
        adminEmail,
        organizationName,
        employeeName,
        leave: {
          type,
          startDate,
          endDate,
          reason
        }
      });
    } catch (emailError) {
      console.error('Failed to send new leave request email:', emailError.message);
    }

    res.status(201).json({
      statusCode: 201,
      message: 'Leave request submitted successfully',
      data: {
        ...createdLeave,
        medical_proof_name: attachment?.file_name || null,
        medical_proof_url: buildAttachmentUrl(req, attachment?.file_path || null),
        medical_proof_mime_type: attachment?.mime_type || null,
        medical_proof_size: attachment?.file_size || null,
      }
    });
  } catch (error) {
    console.error('Error creating leave request:', error);
    const message = error.message || 'Failed to submit leave request';
    const isValidationError =
      error.code === 'P0001' ||
      /required|invalid|overlap|exceed|insufficient|disabled|policy|before/i.test(message);

    res.status(isValidationError ? 400 : 500).json({
      statusCode: isValidationError ? 400 : 500,
      message,
      error: message
    });
  }
};

/**
 * Get leave requests for the logged-in employee
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getMyLeaveRequests = async (req, res) => {
  const employeeId = req.user.employee_id;

  try {
    const result = await pool.query(
      'SELECT * FROM get_employee_leave_requests($1)',
      [employeeId]
    );
    const rowsWithAttachments = await attachLeaveAttachments(req, result.rows);
    // Format start_date and end_date in each row
    const formattedRows = rowsWithAttachments.map((row) => ({
      ...row,
      start_date: new Date(row.start_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      end_date: new Date(row.end_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    }));


    res.status(200).json({
      statusCode: 200,
      message: 'Leave requests retrieved successfully',
      data: formattedRows
    });
  } catch (error) {
    console.error('Error retrieving leave requests:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve leave requests',
      error: error.message
    });
  }
};

const getMyLeaveBalances = async (req, res) => {
  const employeeId = req.user.employee_id;

  try {
    try {
      await syncEarnedLeaveBalanceForEmployee(employeeId, 'earned');
    } catch (syncErr) {
      console.error("Earned leave balance sync on fetch failed:", syncErr.message);
    }


    try {
      await syncEarnedLeaveBalanceForEmployee(employeeId, 'casual');
    } catch (syncErr) {
      console.error("Casual leave balance sync on fetch failed:", syncErr.message);
    }

    const balances = await getEmployeeLeaveBalances(employeeId);

    return res.status(200).json({
      statusCode: 200,
      message: "Leave balances retrieved successfully",
      data: balances,
    });
  } catch (error) {
    console.error("Error retrieving leave balances:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve leave balances",
      error: error.message,
    });
  }
};

/**
 * Get leave requests for a specific employee (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getEmployeeLeaveRequests = async (req, res) => {
  const { employeeId } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM get_employee_leave_requests($1)',
      [employeeId]
    );
    const rowsWithAttachments = await attachLeaveAttachments(req, result.rows);

    res.status(200).json({
      statusCode: 200,
      message: 'Leave requests retrieved successfully',
      data: rowsWithAttachments
    });
  } catch (error) {
    console.error('Error retrieving leave requests:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve leave requests',
      error: error.message
    });
  }
};

/**
 * Get all leave requests (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */

const getAllLeaveRequests = async (req, res) => {
  //   const { status } = req.query;
  const orgID = req.user.organization_id;
  try {
    const result = await pool.query(
      'SELECT * FROM get_all_leave_requests($1)',
      [orgID]
    );
    console.log(result)

    const rowsWithAttachments = await attachLeaveAttachments(req, result.rows);
    const formattedDate = rowsWithAttachments.map((row) => ({
      ...row,
      start_date: new Date(row.start_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      }),
      end_date: new Date(row.end_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }));
    console.log('Formatted Result:', formattedDate);

    return res.status(200).json({
      statusCode: 200,
      message: 'Leave requests retrieved successfully',
      data: formattedDate
    });

  } catch (error) {
    console.error('Error retrieving leave requests:', error);
    return res.status(500).json({
      statusCode: 500,
      message: 'Failed to retrieve leave requests',
      error: error.message
    });
  }
};

/**
 * Get only pending leave requests (admin only)
 */
const getPendingLeaveRequests = async (req, res) => {
  const orgID = req.user.organization_id;
  try {
    const result = await pool.query('SELECT * FROM get_pending_leave_requests($1)', [orgID]);
    const rowsWithAttachments = await attachLeaveAttachments(req, result.rows);

    res.status(200).json({
      success: true, // ✅ Add this line
      statusCode: 200,
      count: rowsWithAttachments.length,
      message: 'Pending leave requests retrieved successfully',
      data: rowsWithAttachments
    });
  } catch (error) {
    console.error('Error retrieving pending leave requests:', error);
    res.status(500).json({
      success: false, // ✅ Add this line too
      statusCode: 500,
      message: 'Failed to retrieve pending leave requests',
      error: error.message
    });
  }
};

/**
 * Update leave request status (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateLeaveRequestStatus = async (req, res) => {
  const { leaveId } = req.params;
  const updated_by = req.user.employee_id;
  const { status } = req.body;

  try {
    // Validate input
    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        statusCode: 400,
        message: 'Status must be either "approved" or "rejected"',
      });
    }

    if (!updated_by) {
      return res.status(400).json({
        statusCode: 400,
        message: 'Updated_by (user id) is required',
      });
    }

    // PostgreSQL function call
    const result = await pool.query(
      'SELECT * FROM update_leave_request_status($1, $2, $3)',
      [parseInt(leaveId), status, parseInt(updated_by)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        statusCode: 404,
        message: 'Leave request not found or not updated',
      });
    }

    // Send email notification to the employee (non-blocking)
    try {
      const leaveData = result.rows[0];
      const employeeId = leaveData.employee_id;

      try {
        await syncEarnedLeaveBalanceForEmployee(employeeId, 'earned');
      } catch (syncErr) {
        console.error("Earned leave balance sync on status update failed:", syncErr.message);
      }

      try {
        await syncEarnedLeaveBalanceForEmployee(employeeId, 'casual');
      } catch (syncErr) {
        console.error("Casual leave balance sync on status update failed:", syncErr.message);
      }

      // Fetch employee details for email
      const employeeResult = await pool.query(
        'SELECT name, email FROM employees WHERE id = $1',
        [employeeId]
      );

      if (employeeResult.rows.length > 0) {
        const employee = employeeResult.rows[0];
        const organizationName = process.env.ORG_NAME || 'Attendix';

        await sendLeaveStatusEmail({
          employeeEmail: employee.email,
          employeeName: employee.name,
          organizationName,
          leave: {
            type: leaveData.type,
            startDate: leaveData.start_date,
            endDate: leaveData.end_date,
            reason: leaveData.reason
          },
          status
        });

        console.log(`Leave ${status} email sent to ${employee.email}`);
      }
    } catch (emailError) {
      console.error('Failed to send leave status email:', emailError.message);
      // Don't fail the API response if email fails
    }

    return res.status(200).json({
      statusCode: 200,
      message: `Leave request ${status}`,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error updating leave request:', error.message);
    return res.status(500).json({
      statusCode: 500,
      message: 'Failed to update leave request',
      error: error.message,
    });
  }
};


// const admin = require("./firebaseAdmin");
// const __mobileNotification = async (device_id, title, body = " ") => {
//   try {
//     const message = {
//       token: device_id,
//       notification: {
//         title: title,
//         body: body,
//       },
//     };

//     const response = await admin
//       .messaging()
//       .send(message)
//       .then((response) => {
//         console.log("Notification sent:", response);
//       })
//       .catch((error) => {
//         console.error("Error sending notification:", error);
//       });
//     return {
//       success: true,
//       statusCode: 200,
//       message: "Notification sent successfully",
//       response,
//     };
//   } catch (error) {
//     console.error("Error sending notification:", error);
//   }
// }


module.exports = {
  createLeaveRequest,
  getMyLeaveRequests,
  getMyLeaveBalances,
  getEmployeeLeaveRequests,
  getAllLeaveRequests,
  getPendingLeaveRequests,
  updateLeaveRequestStatus,
  // __mobileNotification
};
