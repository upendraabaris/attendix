const pool = require("../configure/dbConfig");

const createMasterTask = async (req, res) => {
  const { workspace_id, title, description, start_date, end_date, assignees } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO master_tasks (workspace_id, title, description, start_date, end_date, assignees) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [workspace_id, title, description || null, start_date || null, end_date || null, assignees || []]
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
      `SELECT * FROM master_tasks WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [workspace_id]
    );
    res.status(200).json({ statusCode: 200, data: result.rows });
  } catch (error) {
    res.status(500).json({ statusCode: 500, message: "Failed to fetch master tasks", error: error.message });
  }
};

module.exports = { createMasterTask, getMasterTasks };
