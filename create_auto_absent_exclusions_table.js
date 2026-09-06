// One-off script to create the auto_absent_exclusions table used to let an
// admin exclude specific employees from Auto Absent processing while the
// organization-level Auto Absent setting (auto_absent_settings.is_enabled)
// stays enabled for everyone else.
// Run manually: node create_auto_absent_exclusions_table.js
require("dotenv").config();
const pool = require("./configure/dbConfig");

const main = async () => {
    try {
        await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_absent_exclusions (
        id SERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, employee_id)
      );
    `);

        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_auto_absent_exclusions_org
      ON auto_absent_exclusions(organization_id);
    `);

        console.log("auto_absent_exclusions table is ready.");
    } catch (error) {
        console.error("Failed to create auto_absent_exclusions table:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
