// One-off script to add the expected_clock_in_time column to the employees
// table, used so an admin can configure each employee's expected daily
// clock-in time (compared against their actual clock-in to flag late arrivals).
// Run manually: node add_expected_clock_in_time_column.js
require("dotenv").config();
const pool = require("./configure/dbConfig");

const main = async () => {
    try {
        await pool.query(`
      ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS expected_clock_in_time TIME NULL;
    `);

        console.log("employees.expected_clock_in_time column is ready.");
    } catch (error) {
        console.error("Failed to add expected_clock_in_time column:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
