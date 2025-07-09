const db = require('../configure/dbConfig'); // or your database connection file
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Admin login with email + password
const loginAdmin = async (req, res) => {
    console.log('Request body:', req.body);
  const { email, password } = req.body;

  try {
    const result = (await db.query('SELECT * FROM users WHERE email = $1 AND login_type = $2', [email, 'email']));
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Admin not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
};

// Employee login with mobile (OTP will be verified separately)
const loginEmployee = async (req, res) => {
  const { phone_number } = req.body;

  try {
    const result = await db.query('SELECT id, employee_id, email, phone_number, login_type, created_at FROM users WHERE phone_number = $1 AND login_type = $2', [phone_number, 'mobile']);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Employee not found' });

    // Assuming OTP verification already done via frontend/third-party API

    const token = jwt.sign({ user_id: user.id, employee_id: user.employee_id, role: 'employee' }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: 'Login error' });
  }
};


module.exports = { loginAdmin, loginEmployee }