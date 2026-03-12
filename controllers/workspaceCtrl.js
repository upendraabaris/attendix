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
      `SELECT id, name, created_at
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

  if (!organization_id) {
    return res.status(403).json({ message: "Organization context missing" });
  }
  if (!name) {
    return res.status(400).json({ message: "Workspace name is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO workspaces (name, organization_id)
       VALUES ($1, $2)
       RETURNING id, name, created_at, organization_id`,
      [name, organization_id]
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

    const result = await pool.query(
      `SELECT w.id, w.name, w.created_at
       FROM workspaces w
       JOIN tasks t ON t.workspace_id = w.id
       WHERE t.employee_id = $1 AND w.organization_id = $2
       GROUP BY w.id, w.name, w.created_at
       ORDER BY w.id DESC`,
      [employee_id, organization_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching workspaces:", err);
    res.status(500).json({ message: "Server error while fetching workspaces" });
  }
};