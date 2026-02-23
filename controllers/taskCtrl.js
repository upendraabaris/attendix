const pool = require("../configure/dbConfig");

const RECURRENCE_TYPES = ["none", "daily", "weekly", "monthly"];
const WEEKDAY_MAP = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const toUtcDateOnly = (value) => {
  if (!value) return null;

  const stringValue = String(value).trim();
  const normalized = stringValue.length >= 10 ? stringValue.slice(0, 10) : stringValue;
  const [year, month, day] = normalized.split("-").map(Number);

  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const toDateString = (date) => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const sanitizeRecurrence = (raw = {}) => {
  const recurrenceType = String(raw.recurrence_type || "none").toLowerCase();
  if (!RECURRENCE_TYPES.includes(recurrenceType)) {
    return { error: "Invalid recurrence_type" };
  }

  const dueDate = toUtcDateOnly(raw.due_date);
  if (!dueDate) {
    return { error: "Invalid due_date" };
  }

  const endDate = raw.recurrence_end_date ? toUtcDateOnly(raw.recurrence_end_date) : null;

  let recurrenceDays = null;
  if (recurrenceType === "weekly") {
    const parsed = (Array.isArray(raw.recurrence_days)
      ? raw.recurrence_days
      : String(raw.recurrence_days || "").split(",")
    )
      .map((day) => String(day).trim().toLowerCase())
      .filter(Boolean);

    if (parsed.length === 0) {
      return { error: "Select at least one weekday for weekly recurrence" };
    }

    if (parsed.some((day) => WEEKDAY_MAP[day] === undefined)) {
      return { error: "Invalid recurrence_days values" };
    }

    recurrenceDays = [...new Set(parsed)].join(",");
  }

  let monthlyDay = null;
  if (recurrenceType === "monthly") {
    const dayFromPayload = raw.monthly_day ? Number(raw.monthly_day) : dueDate.getUTCDate();
    if (!Number.isInteger(dayFromPayload) || dayFromPayload < 1 || dayFromPayload > 31) {
      return { error: "monthly_day must be between 1 and 31" };
    }

    monthlyDay = dayFromPayload;
    recurrenceDays = String(monthlyDay);
  }

  if (recurrenceType !== "none") {
    if (!endDate) {
      return { error: "recurrence_end_date is required for recurring tasks" };
    }

    if (endDate.getTime() < dueDate.getTime()) {
      return { error: "recurrence_end_date cannot be before due_date" };
    }
  }

  return {
    recurrenceType,
    dueDate,
    endDate,
    recurrenceDays,
    monthlyDay,
  };
};

const generateRecurringDates = ({ dueDate, endDate, recurrenceType, recurrenceDays, monthlyDay }) => {
  if (recurrenceType === "none") {
    return [toDateString(dueDate)];
  }

  const dates = [];

  if (recurrenceType === "daily") {
    for (let cursor = new Date(dueDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
      dates.push(toDateString(cursor));
    }
    return dates;
  }

  if (recurrenceType === "weekly") {
    const allowedWeekdays = new Set(
      recurrenceDays
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
        .map((d) => WEEKDAY_MAP[d])
    );

    for (let cursor = new Date(dueDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
      if (allowedWeekdays.has(cursor.getUTCDay())) {
        dates.push(toDateString(cursor));
      }
    }
    return dates;
  }

  if (recurrenceType === "monthly") {
    const targetDay = monthlyDay || dueDate.getUTCDate();
    let cursor = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), 1));

    while (cursor <= endDate) {
      const lastDayOfMonth = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)
      ).getUTCDate();
      const effectiveDay = Math.min(targetDay, lastDayOfMonth);
      const candidate = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), effectiveDay)
      );

      if (candidate >= dueDate && candidate <= endDate) {
        dates.push(toDateString(candidate));
      }

      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }

    return dates;
  }

  return [];
};

const formatDate = (value) => {
  if (!value) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const insertGeneratedTasks = async ({
  employeeId,
  title,
  description,
  attachment,
  workspaceId,
  workspaceName,
  recurrenceType,
  recurrenceDays,
  recurrenceEndDate,
  dueDates,
}) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const createdTasks = [];

    for (const dueDate of dueDates) {
      const result = await client.query(
        `INSERT INTO tasks (
           employee_id, title, due_date, description, attachment, workspace_id, workspace_name,
           recurrence_type, recurrence_days, recurrence_end_date
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          employeeId,
          title,
          dueDate,
          description || null,
          attachment || null,
          workspaceId || null,
          workspaceName || null,
          recurrenceType,
          recurrenceDays,
          recurrenceEndDate,
        ]
      );

      createdTasks.push(result.rows[0]);
    }

    await client.query("COMMIT");
    return createdTasks;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const createTask = async (req, res) => {
  const employeeId = req.user.employee_id;
  const { title, due_date, description, attachment, recurrence_type, recurrence_days, recurrence_end_date, monthly_day } = req.body;

  const recurrence = sanitizeRecurrence({
    due_date,
    recurrence_type,
    recurrence_days,
    recurrence_end_date,
    monthly_day,
  });

  if (recurrence.error) {
    return res.status(400).json({ statusCode: 400, message: recurrence.error });
  }

  try {
    const dueDates = generateRecurringDates({
      dueDate: recurrence.dueDate,
      endDate: recurrence.endDate,
      recurrenceType: recurrence.recurrenceType,
      recurrenceDays: recurrence.recurrenceDays,
      monthlyDay: recurrence.monthlyDay,
    });

    const createdTasks = await insertGeneratedTasks({
      employeeId,
      title,
      description,
      attachment,
      workspaceId: null,
      workspaceName: null,
      recurrenceType: recurrence.recurrenceType,
      recurrenceDays: recurrence.recurrenceDays,
      recurrenceEndDate: recurrence.endDate ? toDateString(recurrence.endDate) : null,
      dueDates,
    });

    return res.status(201).json({
      statusCode: 201,
      message: "Task(s) created successfully",
      count: createdTasks.length,
      data: createdTasks,
    });
  } catch (error) {
    console.error("Error creating task:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to create task",
      error: error.message,
    });
  }
};

const getMyTasks = async (req, res) => {
  const employeeId = req.user.employee_id;

  try {
    const result = await pool.query("SELECT * FROM get_tasks_by_employee($1)", [employeeId]);

    const formattedTasks = result.rows.map((task) => ({
      ...task,
      due_date: formatDate(task.due_date),
      recurrence_end_date: formatDate(task.recurrence_end_date),
    }));

    return res.status(200).json({
      statusCode: 200,
      message: "Tasks fetched successfully",
      data: formattedTasks,
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to fetch tasks",
      error: error.message,
    });
  }
};

const updateTaskStatus = async (req, res) => {
  const { taskId, is_completed, status } = req.body;
  const employeeId = req.user.employee_id;
  const role = req.user.role;

  try {
    let result;

    if (role === "admin") {
      result = await pool.query(
        `UPDATE tasks
         SET completed = $1, status = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [is_completed, status, taskId]
      );
    } else {
      result = await pool.query(
        `UPDATE tasks
         SET completed = $1, status = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND employee_id = $4
         RETURNING *`,
        [is_completed, status, taskId, employeeId]
      );
    }

    if (result.rowCount === 0) {
      return res.status(403).json({
        statusCode: 403,
        message:
          role === "admin" ? "Task not found" : "You are not authorized to update this task",
      });
    }

    const updatedTask = result.rows[0];
    const io = req.app.get("io");
    io.emit("taskUpdated", updatedTask);

    return res.status(200).json({
      statusCode: 200,
      message: "Task status updated successfully",
      data: updatedTask,
    });
  } catch (error) {
    console.error("Error updating task status:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to update task",
      error: error.message,
    });
  }
};

const getAllEmployeesTasks = async (req, res) => {
  const organizationId = req.user.organization_id;
  const { status } = req.query;

  try {
    const result = await pool.query("SELECT * FROM get_all_employees_tasks_v2($1)", [organizationId]);
    let tasks = result.rows;

    if (status === "completed") {
      tasks = tasks.filter((task) => task.completed === true);
    } else if (status === "pending") {
      tasks = tasks.filter((task) => task.completed === false);
    }

    const groupedTasks = {};
    for (const task of tasks) {
      const empId = task.employee_id;
      if (!groupedTasks[empId]) {
        groupedTasks[empId] = {
          employee_id: empId,
          name: task.name,
          email: task.email,
          tasks: [],
        };
      }

      const rawDueDate = toUtcDateOnly(task.due_date);

      groupedTasks[empId].tasks.push({
        task_id: task.task_id,
        title: task.title,
        description: task.description,
        due_date_iso: rawDueDate ? toDateString(rawDueDate) : null,
        due_date: formatDate(task.due_date),
        completed: task.completed,
        created_at: task.created_at,
        updated_at: task.updated_at,
        attachment: task.attachment,
        workspace_id: task.workspace_id,
        workspace_name: task.workspace_name,
        status: task.status,
        recurrence_type: task.recurrence_type || "none",
        recurrence_days: task.recurrence_days || null,
        recurrence_end_date: formatDate(task.recurrence_end_date),
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "All employees tasks fetched successfully",
      data: Object.values(groupedTasks),
    });
  } catch (error) {
    console.error("Error fetching all employees tasks:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to fetch all employees tasks",
      error: error.message,
    });
  }
};

const assignTask = async (req, res) => {
  const {
    employee_id,
    title,
    due_date,
    description,
    attachment,
    workspace_id,
    workspace_name,
    recurrence_type,
    recurrence_days,
    recurrence_end_date,
    monthly_day,
  } = req.body;

  const recurrence = sanitizeRecurrence({
    due_date,
    recurrence_type,
    recurrence_days,
    recurrence_end_date,
    monthly_day,
  });

  if (recurrence.error) {
    return res.status(400).json({ statusCode: 400, message: recurrence.error });
  }

  try {
    const dueDates = generateRecurringDates({
      dueDate: recurrence.dueDate,
      endDate: recurrence.endDate,
      recurrenceType: recurrence.recurrenceType,
      recurrenceDays: recurrence.recurrenceDays,
      monthlyDay: recurrence.monthlyDay,
    });

    const createdTasks = await insertGeneratedTasks({
      employeeId: employee_id,
      title,
      description,
      attachment,
      workspaceId: workspace_id,
      workspaceName: workspace_name,
      recurrenceType: recurrence.recurrenceType,
      recurrenceDays: recurrence.recurrenceDays,
      recurrenceEndDate: recurrence.endDate ? toDateString(recurrence.endDate) : null,
      dueDates,
    });

    return res.status(201).json({
      statusCode: 201,
      message: "Task(s) assigned successfully by admin",
      count: createdTasks.length,
      data: createdTasks,
    });
  } catch (error) {
    console.error("Error assigning task:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to assign task",
      error: error.message,
    });
  }
};

const deleteTask = async (req, res) => {
  const { taskId } = req.params;
  const employeeId = req.user.employee_id;
  const role = req.user.role;

  try {
    let result;

    if (role === "admin") {
      result = await pool.query(
        `DELETE FROM tasks
         WHERE id = $1
           AND due_date >= CURRENT_DATE
         RETURNING *`,
        [taskId]
      );
    } else {
      result = await pool.query(
        `DELETE FROM tasks
         WHERE id = $1
           AND employee_id = $2
           AND due_date >= CURRENT_DATE
         RETURNING *`,
        [taskId, employeeId]
      );
    }

    if (result.rowCount === 0) {
      return res.status(400).json({
        statusCode: 400,
        message:
          "Only current date or future date tasks can be deleted, and you must have permission",
      });
    }

    const deletedTask = result.rows[0];
    const io = req.app.get("io");
    io.emit("taskDeleted", {
      task_id: deletedTask.id,
      workspace_id: deletedTask.workspace_id,
      employee_id: deletedTask.employee_id,
    });

    return res.status(200).json({
      statusCode: 200,
      message: "Task deleted successfully",
      data: deletedTask,
    });
  } catch (error) {
    console.error("Error deleting task:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to delete task",
      error: error.message,
    });
  }
};

module.exports = {
  createTask,
  getMyTasks,
  updateTaskStatus,
  getAllEmployeesTasks,
  assignTask,
  deleteTask,
};
