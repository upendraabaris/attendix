const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const dotenv = require("dotenv").config();
const pool = require("./configure/dbConfig");
const cors = require("cors");
const { attachChatSocket } = require("./services/chatSocketService");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

pool.query("SELECT NOW()", (err, result) => {
  if (err) console.error("Database connection failed:", err.message);
  else console.log("Database connected at:", result.rows[0].now);
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
  },
});

attachChatSocket(io);
app.set("io", io);

const attendanceRoute = require("./routes/attendanceRoute");
const leaveRoute = require("./routes/leaveRoute");
const authRoutes = require("./routes/authRoute");
const employeesRoute = require("./routes/employeesRoute");
const tasksRoute = require("./routes/tasksRoute");
const workspaceRoute = require("./routes/workspaceRoute");
const leavePolicyRoutes = require("./routes/leavePolicyRoutes");
const workWeekPolicyRoute = require("./routes/workWeekPolicyRoute");
const holidayRoute = require("./routes/holidayRoute");
const compOffRoute = require("./routes/compOffRoute");
const appVersionRoute = require("./routes/appVersionRoute");
const reportRoute = require("./routes/reportRoute");
const autoAbsentRoute = require("./routes/autoAbsentRoute");
const { startAutoAbsentScheduler } = require("./services/autoAbsentService");
const trackingSettingsRoute = require("./routes/trackingSettingsRoute");
const breakRoutes = require("./routes/breakRoutes");
const supportRoute = require("./routes/supportRoute");
const chatRoute = require("./routes/chatRoute");

app.use("/api/attendance", attendanceRoute);
app.use("/api/leave", leaveRoute);
app.use("/api/auth", authRoutes);
app.use("/api/employee", employeesRoute);
app.use("/api/task", tasksRoute);
app.use("/api/workspaces", workspaceRoute);
app.use("/api/admin/leave-policy", leavePolicyRoutes);
app.use("/api/work-week-policy", workWeekPolicyRoute);
app.use("/api/holidays", holidayRoute);
app.use("/api/comp-off", compOffRoute);
app.use("/api/version", appVersionRoute);
app.use("/api/reports", reportRoute);
app.use("/api/auto-absent", autoAbsentRoute);
app.use("/api/tracking-settings", trackingSettingsRoute);
app.use("/api/break", breakRoutes);
app.use("/api/support", supportRoute);
app.use("/api/chat", chatRoute);

app.get("/", (_req, res) => res.send("Hello world"));

const PORT = process.env.APP_PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

startAutoAbsentScheduler();

console.log("DB HOST:", process.env.HOST);
console.log("DB USER:", process.env.USER1);
console.log("DB NAME:", process.env.DATABASE);
