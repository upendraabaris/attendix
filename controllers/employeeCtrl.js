const pool = require("../configure/dbConfig");

const getAllEmployees = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM get_all_employees()');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

const addEmployee = async (req, res) => {
  const { name, email, phone, role, created_at } = req.body.params;
  console.log(email, 'user email');

  try {
    const result = await pool.query(
      `SELECT * FROM employees WHERE email = $1`,
      [email]
    );

    if (!result.rows.length) {
      const insertResult = await pool.query(
        `INSERT INTO employees (name, email, phone, role, created_at, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [name, email, phone, "employee", created_at, 1]
      );

      return res.status(200).json({
        statusCode: 200,
        message: 'Employee added successfully',
        data: insertResult.rows[0]
      });
    } else {
      return res.status(409).json({
        statusCode: 409,
        message: 'Employee already exists',
        data: result.rows[0]
      });
    }
  } catch (error) {
    console.error('Error adding employee:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to add employee',
      error: error.message
    });
  }
};

// API for latest activity in Attedix app

const getLatestActivity = async (req, res) => {
  const employeeId = req.user.employee_id;

  try {
    const result = await pool.query(
      'SELECT * FROM get_employee_latest_activity($1)',
      [employeeId]
    );

    const formatted = result.rows.map(row => ({
      type: row.activity_type,
      time: new Date(row.activity_date).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }),
      date: new Date(row.activity_date).toLocaleDateString('en-IN', {
        month: 'short',
        day: 'numeric'
      }),
      description: row.description
    }));

    res.status(200).json({
      statusCode: 200,
      message: 'Latest activities fetched',
      data: formatted
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to fetch latest activities',
      error: error.message
    });
  }
};


module.exports = { getAllEmployees, addEmployee, getLatestActivity };
