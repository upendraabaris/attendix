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

    const formattedTasks = result.rows.map(task => {
      const dueDate = new Date(task.due_date);
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      const formattedDueDate = dueDate.toLocaleDateString('en-IN', options); // "July 24, 2025"

      return {
        ...task,
        due_date: formattedDueDate
      };
    });

    res.status(200).json({
      statusCode: 200,
      message: 'Tasks fetched successfully',
      data: formattedTasks
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to fetch tasks',
      error: error.message
    });
  }
};

// const updateTaskStatus = async (req, res) => {
//   const { taskId, is_completed, status } = req.body;
//   const employeeId = req.user.employee_id;
//   const role = req.user.role; // ✅ 'admin' or 'employee'

//   try {
//     let result;

//     if (role === 'admin') {
//       // ✅ Admin can update *any* task
//       result = await pool.query(
//         `UPDATE tasks 
//          SET completed = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
//          WHERE id = $3 
//          RETURNING *`,
//         [is_completed, status, taskId]
//       );
//     } else {
//       // ✅ Employee can update *only their own* task
//       result = await pool.query(
//         `UPDATE tasks 
//          SET completed = $1, status = $2, updated_at = CURRENT_TIMESTAMP 
//          WHERE id = $3 AND employee_id = $4 
//          RETURNING *`,
//         [is_completed, status, taskId, employeeId]
//       );
//     }

//     if (result.rowCount === 0) {
//       return res.status(403).json({
//         statusCode: 403,
//         message:
//           role === 'admin'
//             ? 'Task not found'
//             : 'You are not authorized to update this task',
//       });
//     }
    
//     res.status(200).json({
//       statusCode: 200,
//       message: 'Task status updated successfully',
//       data: result.rows[0],
//     });
//   } catch (error) {
//     console.error('Error updating task status:', error);
//     res.status(500).json({
//       statusCode: 500,
//       message: 'Failed to update task',
//       error: error.message,
//     });
//   }
// };

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
          role === "admin"
            ? "Task not found"
            : "You are not authorized to update this task",
      });
    }

    const updatedTask = result.rows[0];

    // ✅ Emit event to all connected clients
    const io = req.app.get("io");
    io.emit("taskUpdated", updatedTask);

    res.status(200).json({
      statusCode: 200,
      message: "Task status updated successfully",
      data: updatedTask,
    });
  } catch (error) {
    console.error("Error updating task status:", error);
    res.status(500).json({
      statusCode: 500,
      message: "Failed to update task",
      error: error.message,
    });
  }
};


// ✅ Admin fetches all employees' tasks, grouped by employee till 288
const getAllEmployeesTasks = async (req, res) => {
  const organizationId = req.user.organization_id;
  const { status } = req.query; // Optional: 'pending' or 'completed'

  try {
    const result = await pool.query(
      'SELECT * FROM get_all_employees_tasks_v2($1)',
      [organizationId]
    );

    let tasks = result.rows;

    // Optional filtering by status (handled here, not in SQL)
    if (status === 'completed') {
      tasks = tasks.filter(task => task.completed === true);
    } else if (status === 'pending') {
      tasks = tasks.filter(task => task.completed === false);
    }

    // Group tasks by employee
    const groupedTasks = {};
    for (const task of tasks) {
      const empId = task.employee_id;
      if (!groupedTasks[empId]) {
        groupedTasks[empId] = {
          employee_id: empId,
          name: task.name,
          email: task.email,
          tasks: []
        };
      }

      // Format due_date to "August 6, 2025" style
      const dueDate = new Date(task.due_date);
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      const formattedDueDate = dueDate.toLocaleDateString('en-IN', options);

      groupedTasks[empId].tasks.push({
        task_id: task.task_id,
        title: task.title,
        description: task.description,
        due_date: formattedDueDate,
        completed: task.completed,
        created_at: task.created_at,
        updated_at: task.updated_at,
        attachment : task.attachment,
        workspace_id : task.workspace_id,
        workspace_name : task.workspace_name,
        status: task.status,
      });
    }

    const response = Object.values(groupedTasks);

    res.status(200).json({
      statusCode: 200,
      message: 'All employees tasks fetched successfully',
      data: response
    });
  } catch (error) {
    console.error('Error fetching all employees tasks:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to fetch all employees tasks',
      error: error.message
    });
  }
};


// ✅ Admin assigns task to any employee
const assignTask = async (req, res) => {
  const { employee_id, title, due_date, description, attachment, workspace_id ,workspace_name } = req.body;

  try {
    // Task insert kare
    const result = await pool.query(
      // `INSERT INTO tasks(employee_id, title, due_date, description) VALUES($1, $2, $3, $4) RETURNING *`,
      `INSERT INTO tasks(employee_id, title, due_date, description, attachment, workspace_id, workspace_name)
   VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [employee_id, title, due_date, description, attachment, workspace_id ,workspace_name]
    );

    res.status(201).json({
      statusCode: 201,
      message: 'Task assigned successfully by admin',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({
      statusCode: 500,
      message: 'Failed to assign task',
      error: error.message
    });
  }
};

module.exports = {
  createTask,
  getMyTasks,
  updateTaskStatus,
  getAllEmployeesTasks,
  assignTask,
  // getEmployeesWorkspaces // Added this export
};
