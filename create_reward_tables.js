// One-off, idempotent setup script for the Reward Points & Employee Ranking module.
// Creates: reward_settings, reward_punctuality_slabs, employee_reward_points
// plus the constraints, partial unique indexes and performance indexes they need.
//
// Run manually:  node create_reward_tables.js
//
// The SAME script must be run against BOTH the local/dev database and the
// production database (after deploying the code). Do not hand-write separate
// production SQL. Safe to re-run — every statement is IF NOT EXISTS guarded.
// See REWARD_POINTS_MODULE.md section 5 for details.
require("dotenv").config();
const pool = require("./configure/dbConfig");

const main = async () => {
    try {
        // ── 1. Organization-level reward settings (one row per organization) ──
        await pool.query(`
      CREATE TABLE IF NOT EXISTS reward_settings (
        id                      SERIAL PRIMARY KEY,
        organization_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        is_enabled              BOOLEAN NOT NULL DEFAULT false,
        start_date              DATE NULL,
        leave_early_enabled     BOOLEAN NOT NULL DEFAULT false,
        leave_early_days_before INTEGER NULL,
        leave_early_points      INTEGER NULL,
        punctuality_enabled     BOOLEAN NOT NULL DEFAULT false,
        created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id),
        CHECK (leave_early_days_before IS NULL OR leave_early_days_before >= 0),
        CHECK (leave_early_points      IS NULL OR leave_early_points      >= 0)
      );
    `);

        // ── 2. Punctuality reward slabs (many rows per organization) ─────────
        await pool.query(`
      CREATE TABLE IF NOT EXISTS reward_punctuality_slabs (
        id               SERIAL PRIMARY KEY,
        organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        max_minutes_late INTEGER NOT NULL,
        points           INTEGER NOT NULL,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id, max_minutes_late),
        CHECK (max_minutes_late >= 0),
        CHECK (points >= 0)
      );
    `);

        // ── 3. Reward points ledger (append-only source of truth) ───────────
        await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_reward_points (
        id               SERIAL PRIMARY KEY,
        organization_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        rule_type        VARCHAR(32) NOT NULL,
        points           INTEGER NOT NULL,
        award_date       DATE NOT NULL,
        leave_request_id INTEGER NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
        work_date        DATE NULL,
        status           VARCHAR(16) NOT NULL DEFAULT 'active',
        meta             JSONB NULL,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        CHECK (rule_type IN ('leave_early_application','punctuality')),
        CHECK (status    IN ('active','reversed')),
        CHECK (points >= 0)
      );
    `);

        // ── 4. Duplicate-reward prevention (partial unique indexes) ─────────
        // Leave reward: at most one row per employee + rule + leave request.
        await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_points_leave
        ON employee_reward_points (employee_id, rule_type, leave_request_id)
        WHERE leave_request_id IS NOT NULL;
    `);

        // Punctuality reward: at most one row per employee + rule + IST work date.
        // Keying on work_date (not attendance.id) makes "first punch of the day
        // only" a database guarantee.
        await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_points_workdate
        ON employee_reward_points (employee_id, rule_type, work_date)
        WHERE work_date IS NOT NULL;
    `);

        // ── 5. Ranking / lookup indexes ─────────────────────────────────────
        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reward_points_org_date
        ON employee_reward_points (organization_id, award_date);
    `);

        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reward_points_emp_date
        ON employee_reward_points (employee_id, award_date);
    `);

        await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reward_slabs_org
        ON reward_punctuality_slabs (organization_id);
    `);

        console.log("Reward Points tables, constraints and indexes are ready.");
    } catch (error) {
        console.error("Failed to create reward tables:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
