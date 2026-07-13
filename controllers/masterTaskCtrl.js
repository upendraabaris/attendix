const pool = require("../configure/dbConfig");

const createMasterTask = async (req, res) => {
  const { workspace_ids, workspace_id, title, description, start_date, end_date, assignees, priority } = req.body;
  const creatorId = req.user?.employee_id ? Number(req.user.employee_id) : null;
  let assigneesList = Array.isArray(assignees) ? assignees.map(Number) : [];
  
  if (creatorId && !assigneesList.includes(creatorId)) {
    assigneesList.push(creatorId);
  }

  const taskPriority = priority || 'medium';
  let wIds = Array.isArray(workspace_ids) ? workspace_ids.map(Number) : (workspace_id ? [Number(workspace_id)] : []);

  try {
    const result = await pool.query(
      `INSERT INTO master_tasks (workspace_ids, title, description, start_date, end_date, assignees, created_by, priority) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [wIds, title, description || null, start_date || null, end_date || null, assigneesList, creatorId, taskPriority]
    );
    res.status(201).json({ statusCode: 201, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ statusCode: 500, message: "Failed to create master task", error: error.message });
  }
};

const getMasterTasks = async (req, res) => {
  const { workspace_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT m.*, e.name as created_by_name 
       FROM master_tasks m
       LEFT JOIN employees e ON m.created_by = e.id
       WHERE $1 = ANY(m.workspace_ids) 
       ORDER BY m.created_at DESC`,
      [workspace_id]
    );
    res.status(200).json({ statusCode: 200, data: result.rows });
  } catch (error) {
    res.status(500).json({ statusCode: 500, message: "Failed to fetch master tasks", error: error.message });
  }
};

const updateMasterTask = async (req, res) => {
  const { id } = req.params;
  const { title, description, start_date, end_date, assignees, priority, workspace_ids } = req.body;
  let assigneesList = Array.isArray(assignees) ? assignees.map(Number) : [];
  const taskPriority = priority || 'medium';

  try {
    let result;
    if (workspace_ids && Array.isArray(workspace_ids)) {
      const wIds = workspace_ids.map(Number);
      result = await pool.query(
        `UPDATE master_tasks 
         SET title = $1, description = $2, start_date = $3, end_date = $4, assignees = $5, priority = $6, workspace_ids = $7
         WHERE id = $8 RETURNING *`,
        [title, description || null, start_date || null, end_date || null, assigneesList, taskPriority, wIds, id]
      );
    } else {
      result = await pool.query(
        `UPDATE master_tasks 
         SET title = $1, description = $2, start_date = $3, end_date = $4, assignees = $5, priority = $6
         WHERE id = $7 RETURNING *`,
        [title, description || null, start_date || null, end_date || null, assigneesList, taskPriority, id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ statusCode: 404, message: "Master task not found" });
    }

    res.status(200).json({ statusCode: 200, data: result.rows[0] });
  } catch (error) {
    res.status(500).json({ statusCode: 500, message: "Failed to update master task", error: error.message });
  }
};

const getMyMasterTasks = async (req, res) => {
  const employeeId = req.user?.employee_id;

  if (!employeeId) {
    return res.status(403).json({ message: "Employee ID missing in token" });
  }

  try {
    const result = await pool.query(
      `SELECT m.*, e.name as created_by_name,
       (SELECT string_agg(w.name, ', ') FROM workspaces w WHERE w.id = ANY(m.workspace_ids)) as workspace_name
       FROM master_tasks m
       LEFT JOIN employees e ON m.created_by = e.id
       WHERE $1 = ANY(m.assignees)
       ORDER BY m.created_at DESC`,
      [employeeId]
    );
    res.status(200).json({ statusCode: 200, data: result.rows });
  } catch (error) {
    res.status(500).json({ statusCode: 500, message: "Failed to fetch your master tasks", error: error.message });
  }
};

module.exports = { createMasterTask, getMasterTasks, updateMasterTask, getMyMasterTasks };
