const pool = require("../configure/dbConfig");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { sendEmployeeCredentialsEmail } = require("../services/emailService");

function generateRandomPassword(length = 6) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const allChars = letters + digits;

  let password = letters.charAt(crypto.randomInt(0, letters.length));
  password += digits.charAt(crypto.randomInt(0, digits.length));

  for (let i = 2; i < length; i += 1) {
    password += allChars.charAt(crypto.randomInt(0, allChars.length));
  }

  return password;
}

const getAllEmployees = async (req, res) => {
  const orgID = req.user.organization_id;
  try {
    const result = await pool.query(`SELECT * FROM get_all_employees(${orgID})`);
    res.status(200).json({ data: result.rows, message: "success", count: result.rows.length });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// const addEmployee = async (req, res) => {
//   const { name, email, phone, role, created_at } = req.body.params;
//   console.log(email, 'user email');

//   try {
//     const result = await pool.query(
//       `SELECT * FROM employees WHERE email = $1`,
//       [email]
//     );

//     if (!result.rows.length) {
//       const insertResult = await pool.query(
//         `INSERT INTO employees (name, email, phone, role, created_at, organization_id)
//          VALUES ($1, $2, $3, $4, $5, $6)
//          RETURNING *`,
//         [name, email, phone, "employee", created_at, 1]
//       );

//       return res.status(200).json({
//         statusCode: 200,
//         message: 'Employee added successfully',
//         data: insertResult.rows[0]
//       });
//     } else {
//       return res.status(409).json({
//         statusCode: 409,
//         message: 'Employee already exists',
//         data: result.rows[0]
//       });
//     }
//   } catch (error) {
//     console.error('Error adding employee:', error);
//     res.status(500).json({
//       statusCode: 500,
//       message: 'Failed to add employee',
//       error: error.message
//     });
//   }
// };


const addEmployee = async (req, res) => {
  const admin_employee_id = req.user.employee_id;
  const organization_id = req.user.organization_id;
  console.log(admin_employee_id);
  const {
    name,
    email,
    phone,
    role = 'employee'
  } = req.body.params;

  let transactionCommitted = false;
  let createdEmployeeData = null;

  try {
    await pool.query("BEGIN");

    const result = await pool.query(
      `SELECT * FROM add_employee_by_admin_id($1, $2, $3, $4, $5)`,
      [
        admin_employee_id,
        name,
        email,
        phone,
        role
      ]
    );
    createdEmployeeData = result.rows[0];

    const generatedPassword = generateRandomPassword(6);
    const hashedPassword = await bcrypt.hash(generatedPassword, 10);

    const updateResult = await pool.query(
      `
      UPDATE users u
      SET password_hash = $1
      FROM employees e
      WHERE u.employee_id = e.id
        AND u.email = $2
        AND e.organization_id = $3
      RETURNING u.id
      `,
      [hashedPassword, email, organization_id]
    );

    if (updateResult.rows.length === 0) {
      throw new Error("Employee user record not found for password setup");
    }

    await pool.query("COMMIT");
    transactionCommitted = true;

    await sendEmployeeCredentialsEmail({
      employeeEmail: email,
      employeeName: name,
      organizationName: process.env.ORG_NAME || "Attendix",
      password: generatedPassword
    });

    return res.status(200).json({
      statusCode: 200,
      message: "Employee added successfully. Login credentials sent to employee email.",
      data: createdEmployeeData
    });
  } catch (error) {
    if (!transactionCommitted) {
      await pool.query("ROLLBACK");
      console.error('Error:', error);
      return res.status(500).json({
        statusCode: 500,
        message: 'Failed to add employee',
        error: error.message
      });
    }

    console.error('Employee created but credential email failed:', error.message);
    return res.status(200).json({
      statusCode: 200,
      message: "Employee added successfully, but credential email could not be sent. Please verify SMTP settings.",
      data: createdEmployeeData
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

const getEmployeeById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM get_employee_by_id($1)`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching employee by ID:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Update Employee

const updateEmployee = async (req, res) => {
  const { id } = req.params; // employee ID in the URL
  const {
    name,
    email,
    phone,
    role,
    status // ✅ Include status from frontend
  } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM update_employee($1, $2, $3, $4, $5, $6)`,
      [id, name, email, phone, role, status] // ✅ Pass 6 parameters
    );

    return res.status(200).json({
      statusCode: 200,
      message: 'Employee and user updated successfully',
      data: result.rows || {}// function returns void, no rows expected
    });
  } catch (error) {
    console.error('Error updating employee and user:', error);
    return res.status(500).json({
      statusCode: 500,
      message: 'Failed to update employee',
      error: error.message
    });
  }
};



module.exports = { getAllEmployees, addEmployee, getLatestActivity, getEmployeeById, updateEmployee };
