const pool = require("../configure/dbConfig");

const createLeaveRequest = async (req, res) => {
  const { type, startDate, endDate, reason } = req.body;
  const employeeId = req.user.employee_id;

  try {
    // Validate input
    if (!type || !startDate || !endDate) {
      return res.status(400).json({
        statusCode: 400,
        message: 'Type, start date, and end date are required'
      });
    }

    // Call the PostgreSQL function to create leave request
    const result = await pool.query(
      'SELECT * FROM create_leave_request($1, $2, $3, $4, $5)',
      [employeeId, type, startDate, endDate, reason]
    );

    res.status(201).json({
      statusCode: 201,
      message: 'Leave request submitted successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating leave request:', error);
    res.status(500).json({
      statusCode: 500,
      message: error.message || 'Failed to submit leave request',
      error: error.message
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
    // Format start_date and end_date in each row
    const formattedRows = result.rows.map((row) => ({
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

    res.status(200).json({
      statusCode: 200,
      message: 'Leave requests retrieved successfully',
      data: result.rows
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
      `SELECT * FROM get_all_leave_requests(${orgID})`,
    );
    console.log(result)

    const formattedDate = result.rows.map((row) => ({
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
  try {
    const result = await pool.query('SELECT * FROM get_pending_leave_requests()');

    res.status(200).json({
      success: true, // ✅ Add this line
      statusCode: 200,
      message: 'Pending leave requests retrieved successfully',
      data: result.rows
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
  getEmployeeLeaveRequests,
  getAllLeaveRequests,
  getPendingLeaveRequests,
  updateLeaveRequestStatus,
  // __mobileNotification
};