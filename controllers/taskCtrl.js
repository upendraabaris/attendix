const pool = require("../configure/dbConfig");

const createTask = async (req, res) => {
  const { title, due_date } = req.body;
  const employeeId = req.user.employee_id;

  try {
    const result = await pool.query(
      'INSERT INTO tasks (employee_id, title, due_date) VALUES ($1, $2, $3) RETURNING *',
      [employeeId, title, due_date]
    );

    res.status(201).json({
      statusCode: 201,
      message: 'Task created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ statusCode: 500, message: 'Failed to create task', error: error.message });
  }
};

const getMyTasks = async (req, res) => {
  const employeeId = req.user.employee_id;

  try {
    const result = await pool.query(
      'SELECT * FROM get_tasks_by_employee($1)',
      [employeeId]
    );

    res.status(200).json({
      statusCode: 200,
      message: 'Tasks fetched successfully',
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ statusCode: 500, message: 'Failed to fetch tasks', error: error.message });
  }
};

const updateTaskStatus = async (req, res) => {
  const { taskId, is_completed } = req.body;
  const employeeId = req.user.employee_id;

  try {
    const result = await pool.query(
      'UPDATE tasks SET completed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND employee_id = $3 RETURNING *',
      [is_completed, taskId, employeeId]
    );

    res.status(200).json({
      statusCode: 200,
      message: 'Task status updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(500).json({ statusCode: 500, message: 'Failed to update task', error: error.message });
  }
};

module.exports = {
  createTask,
  getMyTasks,
  updateTaskStatus
};
