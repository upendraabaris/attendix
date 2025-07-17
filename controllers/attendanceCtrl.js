const pool = require("../configure/dbConfig");
const { reverseGeocode, reverseGeocodeGoogle } = require('../services/geocodingService');

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
        date: istDate.toISOString().split('T')[0], // "YYYY-MM-DD"
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
  const { startDate, endDate } = req.query;

  // Default to current month if dates not provided
  const start = startDate || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];

  try {
    const result = await pool.query(
      'SELECT * FROM get_all_attendance($1, $2)',
      [start, end]
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

module.exports = {
  clockIn,
  clockOut,
  getMyAttendance,
  getEmployeeAttendance,
  getAllAttendance
};