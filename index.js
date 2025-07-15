const express = require("express");
const dotenv = require('dotenv').config();
const pool = require('./configure/dbConfig');
const app = express();
const cors = require("cors");

pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
  } else {
    console.log('✅ Database connected at:', result.rows[0].now);
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors()); // ✅ CORRECT


const attendanceRoute = require("./routes/attendanceRoute");
const leaveRoute = require("./routes/leaveRoute");
const authRoutes = require('./routes/authRoute');
const employeesRoute = require('./routes/employeesRoute');
app.use('/api/attendance', attendanceRoute);
app.use('/api/leave', leaveRoute);
app.use('/api/auth', authRoutes);
app.use('/api/employee', employeesRoute);

app.listen(4000, () => {
  console.log(`server is running on port: 4000`)
})


