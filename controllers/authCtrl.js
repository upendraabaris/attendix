const db = require('../configure/dbConfig'); // or your database connection file
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Admin login with email + password
const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query(`
      SELECT 
        u.*, 
        e.organization_id,
        e.name
      FROM users u
      JOIN employees e ON u.employee_id = e.id
      WHERE u.email = $1 AND u.login_type = $2
    `, [email, 'email']);

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Admin not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      {
        id: user.id,
        employee_id: user.employee_id,
        organization_id: user.organization_id,  // ✅ include in token
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login error' });
  }
};

// Employee login with mobile (OTP will be verified separately)
const loginEmployee = async (req, res) => {
  const { phone_number, organization_id } = req.body;
  try {
    const result = await db.query(
      `
      SELECT 
  u.id AS user_id,
  u.employee_id,
  e.name AS employee_name,
  u.email,
  u.phone_number,
  u.login_type,
  u.created_at,
  e.organization_id,
      e.status AS employee_status
      FROM users u
      JOIN employees e ON u.employee_id = e.id
      WHERE 
        u.phone_number = $1 
        AND u.login_type = $2 
        AND e.organization_id = $3
        

      `, [phone_number, 'mobile', organization_id]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (user.employee_status !== 'active') {
      return res.status(403).json({ error: 'Employee account is inactive' });
    }
    // Assuming OTP verification already done via frontend/third-party API

    const token = jwt.sign({ user_id: user.id, employee_id: user.employee_id, role: 'employee' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
};

//Get all orgaizations list by phone number
const getOrganizationsByPhone = async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const result = await db.query(
      `SELECT * FROM get_organizations_by_phone($1);`,
      [phone_number]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No organizations found for this phone number' });
    }

    return res.status(200).json({ statusCode: 200, data: result.rows });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return res.status(500).json({ error: 'Server error' });
  }
};

// User Registration Controller (No Password)
const registerUser = async (req, res) => {
  const { name, organization_name, phone, email } = req.body;

  // Basic validation
  if (!name || !organization_name || !phone || !email) {
    return res.status(400).json({ error: 'All fields are required: name, organization_name, phone, email' });
  }

  try {
    await db.query('BEGIN'); // Start transaction

    // 1. Check if organization exists
    const orgResult = await db.query(
      'SELECT id FROM organizations WHERE name = $1',
      [organization_name]
    );

    let organizationId;
    if (orgResult.rows.length > 0) {
      organizationId = orgResult.rows[0].id;
    } else {
      const insertOrg = await db.query(
        'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
        [organization_name]
      );
      organizationId = insertOrg.rows[0].id;
    }

    // 2. Create Employee (handle duplicate email error)
    let employeeId;
    try {
      const insertEmployee = await db.query(
        `INSERT INTO employees (organization_id, name, email, phone, role, status)
         VALUES ($1, $2, $3, $4, 'employee', 'active') RETURNING id`,
        [organizationId, name, email, phone]
      );
      employeeId = insertEmployee.rows[0].id;
    } catch (err) {
      if (err.code === '23505') { // Unique violation
        throw new Error('Email already exists for another user');
      }
      throw err;
    }

    // 3. Create User (handle duplicate email or phone error)
    try {
      await db.query(
        `INSERT INTO users (employee_id, email, phone_number, login_type)
         VALUES ($1, $2, $3, 'mobile')`,
        [employeeId, email, phone]
      );
    } catch (err) {
      if (err.code === '23505') { // Unique violation
        throw new Error('User with this email or phone already exists');
      }
      throw err;
    }

    await db.query('COMMIT'); // Commit transaction

    return res.status(201).json({
      statusCode: 201,
      message: 'User registered successfully',
      data: {
        organization_id: organizationId,
        employee_id: employeeId,
        email: email,
        phone: phone
      }
    });

  } catch (error) {
    await db.query('ROLLBACK'); // Rollback on error
    console.error('Error in user registration:', error.message);
    return res.status(400).json({ error: error.message }); // Send exact reason
  }
};


module.exports = { loginAdmin, loginEmployee, getOrganizationsByPhone, registerUser }