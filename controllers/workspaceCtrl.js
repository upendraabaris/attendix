// // controllers/workspaceCtrl.js
// const pool = require("../configure/dbConfig");

// // 🟢 Get all workspaces
// exports.getAllWorkspaces = async (req, res) => {
//   try {
//     const result = await pool.query("SELECT * FROM workspaces ORDER BY id DESC");
//     res.json(result.rows);
//   } catch (err) {
//     console.error("Error fetching workspaces:", err);
//     res.status(500).json({ message: "Server error while fetching workspaces" });
//   }
// };

// // 🟢 Create new workspace
// exports.createWorkspace = async (req, res) => {
//   const { name } = req.body;

//   if (!name) {
//     return res.status(400).json({ message: "Workspace name is required" });
//   }

//   try {
//     const result = await pool.query(
//       "INSERT INTO workspaces (name) VALUES ($1) RETURNING *",
//       [name]
//     );
//     res.status(201).json(result.rows[0]);
//   } catch (err) {
//     console.error("Error creating workspace:", err);
//     res.status(500).json({ message: "Server error while creating workspace" });
//   }
// };


// exports.getAllWorkspacesByEmployeeId = async (req, res) => {
//   try {
//     const employee_id = req.user.employee_id;
//     console.log(req.user);
//     // const result = await pool.query(`SELECT name FROM tasks left join workspaces where workspace_id = id AND where employee_id = ${employee_id} ORDER BY id DESC`);
//     // res.json(result.rows);
//     const result = await pool.query(`
//   SELECT w.name,w.id
//   FROM workspaces w
//   JOIN tasks t ON t.workspace_id = w.id
//   WHERE t.employee_id = $1
//   GROUP BY w.id
//   ORDER BY w.id DESC
// `, [employee_id]);

// res.json(result.rows);

//   } catch (err) {
//     console.error("Error fetching workspaces:", err);
//     res.status(500).json({ message: "Server error while fetching workspaces" });
//   }
// };

const pool = require("../configure/dbConfig");

exports.getAllWorkspaces = async (req, res) => {
  try {
    const organization_id = req.user?.organization_id;
    if (!organization_id) {
      return res.status(403).json({ message: "Organization context missing" });
    }

    const result = await pool.query(
      `SELECT id, name, created_at, created_by_name
       FROM workspaces
       WHERE organization_id = $1
       ORDER BY id DESC`,
      [organization_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching workspaces:", err);
    res.status(500).json({ message: "Server error while fetching workspaces" });
  }
};

exports.createWorkspace = async (req, res) => {
  const rawName = req.body?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const organization_id = req.user?.organization_id;
  const employee_id = req.user?.employee_id;

  let created_by_name = req.body?.created_by_name || req.user?.employee_name;

  if (!organization_id) {
    return res.status(403).json({ message: "Organization context missing" });
  }
  if (!name) {
    return res.status(400).json({ message: "Workspace name is required" });
  }

  try {
    if (!created_by_name && employee_id) {
      const empRes = await pool.query('SELECT name FROM employees WHERE id = $1', [employee_id]);
      if (empRes.rows[0]) created_by_name = empRes.rows[0].name;
    }
    created_by_name = created_by_name || "Admin";

    const result = await pool.query(
      `INSERT INTO workspaces (name, organization_id, created_by_name)
       VALUES ($1, $2, $3)
       RETURNING id, name, created_at, organization_id, created_by_name`,
      [name, organization_id, created_by_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Workspace name already exists in this organization" });
    }
    console.error("Error creating workspace:", err);
    res.status(500).json({ message: "Server error while creating workspace" });
  }
};

exports.getAllWorkspacesByEmployeeId = async (req, res) => {
  try {
    const employee_id = req.user?.employee_id;
    const organization_id = req.user?.organization_id;

    if (!employee_id || !organization_id) {
      return res.status(403).json({ message: "User context missing" });
    }

    const empRes = await pool.query('SELECT name FROM employees WHERE id = $1', [employee_id]);
    const employee_name = empRes.rows[0]?.name || '';

    const result = await pool.query(
      `SELECT w.id, w.name, w.created_at, w.created_by_name
       FROM workspaces w
       LEFT JOIN tasks t ON t.workspace_id = w.id AND t.employee_id = $1
       LEFT JOIN master_tasks mt ON mt.workspace_id = w.id AND $1 = ANY(mt.assignees)
       WHERE w.organization_id = $2 AND (t.employee_id IS NOT NULL OR mt.id IS NOT NULL OR w.created_by_name = $3)
       GROUP BY w.id, w.name, w.created_at, w.created_by_name
       ORDER BY w.id DESC`,
      [employee_id, organization_id, employee_name]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching workspaces:", err);
    res.status(500).json({ message: "Server error while fetching workspaces" });
  }
};