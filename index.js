// const express = require("express");
// const dotenv = require('dotenv').config();
// const pool = require('./configure/dbConfig');
// const app = express();
// const cors = require("cors");


// pool.query('SELECT NOW()', (err, result) => {
//   if (err) {
//     console.error('❌ Database connection failed:', err.message);
//   } else {
//     console.log('✅ Database connected at:', result.rows[0].now);
//   }
// });

// app.use(express.json({ limit: '50mb' }));
// app.use(express.urlencoded({ limit: '50mb', extended: true }));
// app.use(cors()); // ✅ CORRECT


// const attendanceRoute = require("./routes/attendanceRoute");
// const leaveRoute = require("./routes/leaveRoute");
// const authRoutes = require('./routes/authRoute');
// const employeesRoute = require('./routes/employeesRoute');
// const tasksRoute = require('./routes/tasksRoute')
// const workspaceRoute = require("./routes/workspaceRoute");



// app.use('/api/attendance', attendanceRoute);
// app.use('/api/leave', leaveRoute);
// app.use('/api/auth', authRoutes);
// app.use('/api/employee', employeesRoute);
// app.use('/api/admin', leaveRoute);  // ✅ clean base path
// app.use('/api/task', tasksRoute);
// app.use("/api/workspaces", workspaceRoute);

// app.get('/', async (req, res) => {
//   try {
//     res.send("Hello world");
//   } catch (err) {
//     res.status(500).json({ message: 'Internal server error' });
//   }
// })


// app.listen(4000, () => {
//   console.log(`server is running on port: 4000`)
// })

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv").config();
const pool = require("./configure/dbConfig");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ Database connection test
pool.query("SELECT NOW()", (err, result) => {
  if (err) console.error("❌ Database connection failed:", err.message);
  else console.log("✅ Database connected at:", result.rows[0].now);
});

// ✅ Create HTTP server for Socket.IO
const server = http.createServer(app);

// ✅ Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // You can restrict this to your frontend domain
    methods: ["GET", "POST"],
  },
});

// ✅ Listen for socket connections
io.on("connection", (socket) => {
  console.log("🟢 A user connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

// ✅ Make io globally accessible (for controllers)
app.set("io", io);

// ✅ Routes
const attendanceRoute = require("./routes/attendanceRoute");
const leaveRoute = require("./routes/leaveRoute");
const authRoutes = require("./routes/authRoute");
const employeesRoute = require("./routes/employeesRoute");
const tasksRoute = require("./routes/tasksRoute");
const workspaceRoute = require("./routes/workspaceRoute");

app.use("/api/attendance", attendanceRoute);
app.use("/api/leave", leaveRoute);
app.use("/api/auth", authRoutes);
app.use("/api/employee", employeesRoute);
app.use("/api/admin", leaveRoute);
app.use("/api/task", tasksRoute);
app.use("/api/workspaces", workspaceRoute);

// ✅ Default route
app.get("/", (req, res) => res.send("Hello world"));

// ✅ Start server
const PORT = 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

