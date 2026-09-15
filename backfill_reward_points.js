// One-time (repeatable, idempotent) historical reward-points calculation.
//
// Walks existing attendance and approved-leave activity from each organization's
// Reward System Start Date onward and stores any MISSING rows in
// employee_reward_points. Already-earned rows are never modified, re-scored or
// duplicated, so this is safe to re-run.
//
// Run manually:
//   node backfill_reward_points.js                 -> every enabled organization
//   node backfill_reward_points.js 1               -> organization 1 only
//   node backfill_reward_points.js 1 2026-01-01 2026-09-11   -> org 1, explicit range
//
// The range is always clamped to the organization's start date; activity before
// it is never eligible.
//
// IMPORTANT LIMITATION: reward_settings / reward_punctuality_slabs hold only the
// CURRENT configuration (no effective dates, no history, no triggers anywhere in
// the schema), so historical activity is scored with the settings in force AT
// THE MOMENT THIS SCRIPT RUNS. Past settings cannot be reconstructed and are not
// guessed. Configure the intended settings BEFORE running this.
//
// See REWARD_POINTS_MODULE.md.
require("dotenv").config();
const pool = require("./configure/dbConfig");
const { backfillRewardPoints } = require("./services/rewardPointsService");

const main = async () => {
    const [orgArg, fromArg, toArg] = process.argv.slice(2);

    try {
        let organizationIds;
        if (orgArg) {
            const parsed = Number.parseInt(orgArg, 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error(`Invalid organization id: ${orgArg}`);
            }
            organizationIds = [parsed];
        } else {
            const orgs = await pool.query(
                `SELECT organization_id FROM reward_settings
                 WHERE is_enabled = true AND start_date IS NOT NULL
                 ORDER BY organization_id ASC`
            );
            organizationIds = orgs.rows.map((r) => r.organization_id);
        }

        if (!organizationIds.length) {
            console.log("No organization has the reward system enabled with a start date. Nothing to do.");
            return;
        }

        for (const organizationId of organizationIds) {
            const summary = await backfillRewardPoints({
                organizationId,
                from: fromArg,
                to: toArg,
            });

            if (!summary.ran) {
                console.log(`org ${organizationId}: skipped (${summary.reason})`);
                continue;
            }

            const s = summary.settings_snapshot;
            console.log(
                `org ${organizationId}: ${summary.from} -> ${summary.to} (start_date ${summary.start_date})\n` +
                `  settings used: leave_early=${s.leave_early_enabled}` +
                `${s.leave_early_enabled ? ` (${s.leave_early_days_before}d -> ${s.leave_early_points}pts)` : ""}` +
                `, punctuality=${s.punctuality_enabled}\n` +
                `  leave:       scanned=${summary.leave.scanned} created=${summary.leave.created} skipped=${summary.leave.skipped}\n` +
                `  punctuality: scanned=${summary.punctuality.scanned} created=${summary.punctuality.created} skipped=${summary.punctuality.skipped}`
            );

            if (summary.errors.length) {
                console.log(`  ${summary.errors.length} error(s):`);
                summary.errors.slice(0, 20).forEach((e) => console.log(`    - ${e}`));
            }
        }

        console.log("\nBackfill complete. Stored reward points are now immutable earned points.");
    } catch (error) {
        console.error("Backfill failed:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

main();
