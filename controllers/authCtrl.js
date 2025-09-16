const db = require('../configure/dbConfig'); // Database connection
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require("dotenv").config();

console.log("JWT_SECRET in login:", process.env.JWT_SECRET);

// ================================
// Admin login with phone + org_id
// ================================
const loginAdmin = async (req, res) => {
  const { phone_number, organization_id } = req.body;

  if (!phone_number || !organization_id) {
    return res.status(400).json({ error: 'Phone number and organization ID are required' });
  }

  try {
    const result = await db.query(`
      SELECT 
        u.id AS user_id,
        u.employee_id,
        e.name AS employee_name,
        u.email,
        u.phone_number,
        u.login_type,
        u.created_at,
        e.organization_id,
        e.status AS employee_status,
        e.role AS employee_role
      FROM users u
      JOIN employees e ON u.employee_id = e.id
      WHERE 
        u.phone_number = $1 
        AND u.login_type = $2 
        AND e.organization_id = $3
    `, [phone_number, 'mobile', organization_id]);

    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Admin not found' });
    if (user.employee_status !== 'active') return res.status(403).json({ error: 'Admin account is inactive' });
    if (user.employee_role !== 'admin') return res.status(403).json({ error: 'Access denied: Not an admin' });

    // ✅ Generate JWT
    const token = jwt.sign(
      {
        user_id: user.user_id,
        employee_id: user.employee_id,
        organization_id: user.organization_id,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({ token, user });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login error', details: err.message });
  }
};

// ================================
// Employee login with mobile
// ================================
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
      `, 
      [phone_number, 'mobile', organization_id]
    );

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Employee not found' });
    if (user.employee_status !== 'active') return res.status(403).json({ error: 'Employee account is inactive' });

    // ✅ Generate JWT
    const token = jwt.sign(
      { user_id: user.user_id, employee_id: user.employee_id, role: 'employee' },
      process.env.JWT_SECRET
    );
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
};

// ================================
// Get organizations by phone
// ================================
const getOrganizationsByPhone = async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'Phone number is required' });

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

// ================================
// User Registration (No Password)
// ================================
const registerUser = async (req, res) => {
  const { name, organization_name, phone, email } = req.body;
  if (!name || !organization_name || !phone || !email) {
    return res.status(400).json({ error: 'All fields are required: name, organization_name, phone, email' });
  }

  try {
    await db.query('BEGIN'); // Start transaction

    // 1. Check or insert organization
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

    // 2. Insert Employee
    let employeeId;
    try {
      const insertEmployee = await db.query(
        `INSERT INTO employees (organization_id, name, email, phone, role, status)
         VALUES ($1, $2, $3, $4, 'admin', 'active') RETURNING id`,
        [organizationId, name, email, phone]
      );
      employeeId = insertEmployee.rows[0].id;
    } catch (err) {
      if (err.code === '23505') throw new Error('Email already exists for another user');
      throw err;
    }

    // 3. Insert User
    try {
      await db.query(
        `INSERT INTO users (employee_id, email, phone_number, login_type)
         VALUES ($1, $2, $3, 'mobile')`,
        [employeeId, email, phone]
      );
    } catch (err) {
      if (err.code === '23505') throw new Error('User with this email or phone already exists');
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
    return res.status(400).json({ error: error.message });
  }
};

// ================================
// Admin Login (Email + Password)
// ================================
const loginAdminDashboard = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const result = await db.query(`
      SELECT 
        u.id AS user_id,
        u.employee_id,
        e.name AS employee_name,
        u.email,
        u.password_hash,
        u.login_type,
        u.created_at,
        e.organization_id,
        e.status AS employee_status,
        e.role AS employee_role
      FROM users u
      JOIN employees e ON u.employee_id = e.id
      WHERE u.email = $1
    `, [email]);

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'Admin not found' });
    if (user.employee_status !== 'active') return res.status(403).json({ error: 'Admin account is inactive' });
    if (user.employee_role !== 'admin') return res.status(403).json({ error: 'Access denied: Not an admin' });

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      {
        user_id: user.user_id,
        employee_id: user.employee_id,
        organization_id: user.organization_id,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    delete user.password_hash;
    res.json({ token, user });
  } catch (err) {
    console.error('Admin email login error:', err);
    res.status(500).json({ error: 'Login error', details: err.message });
  }
};

// ================================
// Change Password (Authenticated)
// ================================
const changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old password and new password are required' });
  }

  try {
    const userId = req.user.user_id; // from middleware

    const result = await db.query(
      `SELECT id, password_hash FROM users WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: 'Old password is incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await db.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [hashedPassword, userId]
    );

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};

// ================================
// Exports
// ================================
module.exports = { 
  loginAdmin, 
  loginEmployee, 
  getOrganizationsByPhone, 
  registerUser, 
  loginAdminDashboard,
  changePassword
};
