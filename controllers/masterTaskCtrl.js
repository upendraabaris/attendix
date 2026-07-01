const pool = require("../configure/dbConfig");

const createMasterTask = async (req, res) => {
  const { workspace_id, title, description, start_date, end_date, assignees } = req.body;
  const creatorId = req.user?.employee_id ? Number(req.user.employee_id) : null;
  let assigneesList = Array.isArray(assignees) ? assignees.map(Number) : [];
  
  if (creatorId && !assigneesList.includes(creatorId)) {
    assigneesList.push(creatorId);
  }

  try {
    const result = await pool.query(
      `INSERT INTO master_tasks (workspace_id, title, description, start_date, end_date, assignees, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [workspace_id, title, description || null, start_date || null, end_date || null, assigneesList, creatorId]
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
       WHERE m.workspace_id = $1 
       ORDER BY m.created_at DESC`,
      [workspace_id]
    );
    res.status(200).json({ statusCode: 200, data: result.rows });
  } catch (error) {
    res.status(500).json({ statusCode: 500, message: "Failed to fetch master tasks", error: error.message });
  }
};

module.exports = { createMasterTask, getMasterTasks };
