// controllers/workspaceCtrl.js
const pool = require("../configure/dbConfig");

// 🟢 Get all workspaces
exports.getAllWorkspaces = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM workspaces ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching workspaces:", err);
    res.status(500).json({ message: "Server error while fetching workspaces" });
  }
};

// 🟢 Create new workspace
exports.createWorkspace = async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Workspace name is required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO workspaces (name) VALUES ($1) RETURNING *",
      [name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating workspace:", err);
    res.status(500).json({ message: "Server error while creating workspace" });
  }
};


exports.getAllWorkspacesByEmployeeId = async (req, res) => {
  try {
    const employee_id = req.user.employee_id;
    console.log(req.user);
    // const result = await pool.query(`SELECT name FROM tasks left join workspaces where workspace_id = id AND where employee_id = ${employee_id} ORDER BY id DESC`);
    // res.json(result.rows);
    const result = await pool.query(`
  SELECT w.name,w.id
  FROM workspaces w
  JOIN tasks t ON t.workspace_id = w.id
  WHERE t.employee_id = $1
  GROUP BY w.id
  ORDER BY w.id DESC
`, [employee_id]);

res.json(result.rows);

  } catch (err) {
    console.error("Error fetching workspaces:", err);
    res.status(500).json({ message: "Server error while fetching workspaces" });
  }
};
