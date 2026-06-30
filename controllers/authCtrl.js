const db = require('../configure/dbConfig'); // or your database connection file
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { syncEarnedLeaveBalanceForEmployee } = require('../services/leaveBalanceService');

// Admin login with email + password
// Admin login with mobile + OTP (OTP verification assumed done)
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

    if (!user) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (user.employee_status !== 'active') {
      return res.status(403).json({ error: 'Admin account is inactive' });
    }

    if (user.employee_role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Not an admin' });
    }

    // ✅ Assuming OTP verification already done via frontend or third-party service

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


// Employee login with mobile (OTP will be verified separately)
// const loginEmployee = async (req, res) => {
//   const { phone_number, organization_id } = req.body;
//   try {
//     const result = await db.query(
//       `
//       SELECT 
//   u.id AS user_id,
//   u.employee_id,
//   e.name AS employee_name,
//   u.email,
//   u.phone_number,
//   u.login_type,
//   u.created_at,
//   e.organization_id,
//       e.status AS employee_status
//       FROM users u
//       JOIN employees e ON u.employee_id = e.id
//       WHERE 
//         u.phone_number = $1 
//         AND u.login_type = $2 
//         AND e.organization_id = $3


//       `, [phone_number, 'mobile', organization_id]);
//     const user = result.rows[0];

//     if (!user) {
//       return res.status(404).json({ error: 'Employee not found' });
//     }

//     if (user.employee_status !== 'active') {
//       return res.status(403).json({ error: 'Employee account is inactive' });
//     }
//     // Assuming OTP verification already done via frontend/third-party API

//     const token = jwt.sign({ user_id: user.id, employee_id: user.employee_id, role: 'employee' }, process.env.JWT_SECRET);
//     res.json({ token, user });
//   } catch (err) {
//     res.status(500).json({ error: 'Login error' });
//   }
// }; 

const loginEmployee = async (req, res) => {
  const { phone_number, organization_id } = req.body;

  if (!phone_number || !organization_id) {
    return res.status(400).json({ error: 'Phone number and organization ID are required' });
  }

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

    if (!user) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (user.employee_status !== 'active') {
      return res.status(403).json({ error: 'Employee account is inactive' });
    }

    // ✅ Include organization_id inside token
    const token = jwt.sign(
      {
        user_id: user.user_id,
        employee_id: user.employee_id,
        organization_id: user.organization_id, // 👈 added
        role: 'employee'
      },
      process.env.JWT_SECRET,
      { expiresIn: '365d' }
    );

    res.json({ token, user });
  } catch (err) {
    console.error('Employee login error:', err);
    res.status(500).json({ error: 'Login error', details: err.message });
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
         VALUES ($1, $2, $3, $4, 'admin', 'active') RETURNING id`,
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

// ✅ Admin Login with Email + Password
const loginAdminDashboard = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await db.query(`
      SELECT 
        u.id AS user_id,
        u.employee_id,
        e.name AS employee_name,
        u.email,
        u.password_hash, -- stored hash
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

    if (!user) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    if (user.employee_status !== 'active') {
      return res.status(403).json({ error: 'Admin account is inactive' });
    }

    if (user.employee_role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Not an admin' });
    }

    // ✅ Compare password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // ✅ Generate JWT
    const token = jwt.sign(
      {
        user_id: user.user_id,
        employee_id: user.employee_id,
        organization_id: user.organization_id,
        role: 'admin'
      },
      process.env.JWT_SECRET,
      //token valid for 1 day for dashboard access (can be adjusted as needed)
      { expiresIn: '1d' }
    );

    // remove password before sending user object
    delete user.password;

    res.json({ token, user });
  } catch (err) {
    console.error('Admin email login error:', err);
    res.status(500).json({ error: 'Login error', details: err.message });
  }
};

// Employee Login with Email + Password (Web Dashboard)
const loginEmployeeDashboard = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await db.query(
      `
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
      `,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (user.employee_status !== 'active') {
      return res.status(403).json({ error: 'Employee account is inactive' });
    }

    if (user.employee_role === 'admin') {
      return res.status(403).json({ error: 'Access denied: Admin must use admin login' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
        employee_id: user.employee_id,
        organization_id: user.organization_id,
        role: 'employee'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    delete user.password_hash;

    return res.json({ token, user });
  } catch (err) {
    console.error('Employee email login error:', err);
    return res.status(500).json({ error: 'Login error', details: err.message });
  }
};

const loginSupportDashboard = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await db.query(
      `
      SELECT
        id,
        name,
        email,
        password_hash,
        status,
        created_at
      FROM support_users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'Support user not found' });
    }

    if (String(user.status || '').toLowerCase() !== 'active') {
      return res.status(403).json({ error: 'Support account is inactive' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        support_user_id: user.id,
        role: 'support'
      },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    delete user.password_hash;

    return res.json({
      token,
      user: {
        ...user,
        role: 'support'
      }
    });
  } catch (err) {
    console.error('Support login error:', err);
    return res.status(500).json({ error: 'Login error', details: err.message });
  }
};

// Change Password (Authenticated)
// ================================
const changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old password and new password are required' });
  }

  try {
    const userId = req.user.user_id;
    const supportUserId = req.user.support_user_id;
    const isSupportUser = Boolean(supportUserId) && String(req.user.role || '').toLowerCase() === 'support';

    const result = isSupportUser
      ? await db.query(
          `SELECT id, password_hash FROM support_users WHERE id = $1`,
          [supportUserId]
        )
      : await db.query(
          `SELECT id, password_hash FROM users WHERE id = $1`,
          [userId]
        );

    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isMatch) return res.status(400).json({ error: 'Old password is incorrect' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    if (isSupportUser) {
      await db.query(
        `UPDATE support_users SET password_hash = $1 WHERE id = $2`,
        [hashedPassword, supportUserId]
      );
    } else {
      await db.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [hashedPassword, userId]
      );
    }

    res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error.message);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
};


// ─── Organization Settings ───────────────────────────────────────────────────

/**
 * GET /admin/organization-settings
 * Returns the current organization settings for the logged-in admin.
 */
const getOrganizationSettings = async (req, res) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (!role.includes("admin")) {
    return res.status(403).json({ statusCode: 403, message: "Forbidden: admin access required" });
  }

  const organizationId = req.user.organization_id;
  if (!organizationId) {
    return res.status(400).json({ statusCode: 400, message: "Organization ID missing in token" });
  }

  try {
    const result = await db.query(
      `SELECT id, name, leave_renewal_type FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ statusCode: 404, message: "Organization not found" });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Organization settings retrieved successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching organization settings:", error.message);
    return res.status(500).json({ statusCode: 500, message: "Failed to retrieve organization settings", error: error.message });
  }
};

/**
 * PUT /admin/organization-settings
 * Updates organization-level settings. Currently supports: leave_renewal_type.
 */
const updateOrganizationSettings = async (req, res) => {
  const role = String(req.user?.role || "").toLowerCase();
  if (!role.includes("admin")) {
    return res.status(403).json({ statusCode: 403, message: "Forbidden: admin access required" });
  }

  const organizationId = req.user.organization_id;
  if (!organizationId) {
    return res.status(400).json({ statusCode: 400, message: "Organization ID missing in token" });
  }

  const { leave_renewal_type } = req.body;
  const VALID_RENEWAL_TYPES = ["date_of_joining", "calendar_year"];

  if (!leave_renewal_type || !VALID_RENEWAL_TYPES.includes(leave_renewal_type)) {
    return res.status(400).json({
      statusCode: 400,
      message: `leave_renewal_type must be one of: ${VALID_RENEWAL_TYPES.join(", ")}`
    });
  }

  try {
    const result = await db.query(
      `UPDATE organizations SET leave_renewal_type = $1 WHERE id = $2 RETURNING id, name, leave_renewal_type`,
      [leave_renewal_type, organizationId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ statusCode: 404, message: "Organization not found" });
    }

    // ── Background: re-sync all active employees' leave balances with new renewal type ──
    // This runs asynchronously so it doesn't block the API response
    setImmediate(async () => {
      try {
        const empResult = await db.query(
          `SELECT id FROM employees WHERE organization_id = $1 AND COALESCE(status, 'active') = 'active'`,
          [organizationId]
        );
        for (const emp of empResult.rows) {
          try { await syncEarnedLeaveBalanceForEmployee(emp.id, 'earned'); } catch (e) {
            console.error(`Renewal resync earned failed for emp ${emp.id}:`, e.message);
          }
          try { await syncEarnedLeaveBalanceForEmployee(emp.id, 'casual'); } catch (e) {
            console.error(`Renewal resync casual failed for emp ${emp.id}:`, e.message);
          }
        }
        console.log(`[OrgSettings] Leave balance re-sync complete for org ${organizationId} (renewal: ${leave_renewal_type})`);
      } catch (syncErr) {
        console.error(`[OrgSettings] Leave balance re-sync failed for org ${organizationId}:`, syncErr.message);
      }
    });

    return res.status(200).json({
      statusCode: 200,
      message: "Organization settings updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating organization settings:", error.message);
    return res.status(500).json({ statusCode: 500, message: "Failed to update organization settings", error: error.message });
  }
};

module.exports = {
  loginAdmin,
  loginEmployee,
  getOrganizationsByPhone,
  registerUser,
  loginAdminDashboard,
  loginEmployeeDashboard,
  loginSupportDashboard,
  changePassword,
  getOrganizationSettings,
  updateOrganizationSettings,
};
