# Attendix — Reward Points & Employee Ranking

**Status:** FINAL SPECIFICATION — awaiting approval. No code written, no DB changes made.

**Version:** 1.0 (v1 scope)

**Repos**
- Backend: `C:\Attendixapp\Attendix_Backend\attendix`
- React Admin Frontend: `C:\Attendixapp\attendix-admin-panel`
- The legacy FlutterFlow project is out of scope and must not be touched.

**Purpose of this document.** A developer must be able to implement this feature module-by-module from this document alone, without making any business decisions. Every business rule below is final. Where genuine ambiguity remains it is listed in §14 and must be resolved before the affected module starts.

---

## 1. Feature summary

Employees earn reward points from configurable organization-level rules. Two rules exist in v1:

| Rule | Trigger | Awarded on |
|---|---|---|
| Leave early-application | Admin/manager **approves** a leave request that was applied at least *N* days before its start date | Approval date (IST) |
| Punctuality | Employee's **first** clock-in of an IST calendar day, compared against their existing employee-level Expected Clock-In Time | Work date (IST) |

Points accumulate in an append-only ledger. Rankings are computed by aggregating that ledger over an admin/employee-selected date range.

**Non-goals for v1:** historical backfill, automatic recalculation, point expiry, point redemption, per-org timezones, manual point adjustment by admin, notifications.

---

## 2. Verified existing-system facts

Everything in this section was verified directly against the repos and the live database. Implementers should not re-derive these.

### 2.1 Leave flow

| Fact | Evidence |
|---|---|
| `POST /api/leave` creates a request | `routes/leaveRoute.js:23` → `controllers/leaveCtrl.js:140-370` |
| `PUT /api/leave/update/:leaveId` approves/rejects | `routes/leaveRoute.js:62` → `controllers/leaveCtrl.js:908-1049` (this is the **live** handler; two commented-out older versions sit above it at `:781-875` and `:878-907`) |
| Approver may be an admin (`role.includes("admin")`) or the employee's `manager_id` | `leaveCtrl.js:911-912, 932-957` |
| Status values are exactly `pending` \| `approved` \| `rejected` | DB CHECK `leave_requests_status_check`; no `cancelled` state exists |
| `update_leave_request_status(p_leave_id, p_status, p_updated_by)` returns `(id, employee_id, type, start_date, end_date, reason, status, updated_at, updated_by)` | `pg_get_function_result` |
| That function has **no** `AND status = 'pending'` guard — it is `UPDATE leave_requests ... WHERE lr.id = p_leave_id` | full function body inspected |
| ⚠️ Consequence: repeated approve calls re-fire every side effect (and re-deduct balances) | — |
| `leave_requests.created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP` is the only "when applied" timestamp; no `applied_at` column exists | `information_schema.columns` |
| `start_date` / `end_date` are plain `date` (no time component) | `information_schema.columns` |
| No cancel, edit, or delete endpoint exists for leave requests. Only three code paths mutate the table: create (`leaveCtrl.js:182`), status update (`:960`), and the auto-absent insert (`services/autoAbsentService.js:210-221`) | exhaustive grep |
| Existing approval side effects: balance syncs (`:977-987`), status email (`:990-1013`), push (`:1021-1034`) — each in its own `try/catch` that only `console.error`s | — |
| Live data: **290 pending / 29 approved / 8 rejected** | `SELECT status, COUNT(*) FROM leave_requests GROUP BY status` |

### 2.2 Attendance flow

| Fact | Evidence |
|---|---|
| `POST /api/attendance/clock-in` | `routes/attendanceRoute.js:21` → `controllers/attendanceCtrl.js:20-48` |
| `clockIn` currently has **zero** side effects — geocode, one stored-function call, respond | `attendanceCtrl.js:20-48` |
| `clock_in()` returns `(id, employee_id, type, timestamp, latitude, longitude, address, created_at)` | `pg_get_function_result` |
| `attendance.timestamp` is set by the **DB** (`DEFAULT CURRENT_TIMESTAMP`); Node never sends it | `information_schema.columns`, `attendanceCtrl.js:20-48` |
| `attendance.type` CHECK allows only `'in'` / `'out'` | `attendance_type_check` |
| `attendance` has **no** `organization_id` — join via `employees` | `information_schema.columns`; see also comment at `controllers/reportCtrl.js:91` |
| `clockOut` has five side effects, each error-swallowing | `attendanceCtrl.js:59-94` |

### 2.3 Timezone

| Fact | Evidence |
|---|---|
| DB server timezone is **UTC** | `SHOW timezone` → `UTC` |
| Timestamps are stored UTC-naive and shifted to IST on read | — |
| JS convention: `+330` minutes / `+5.5h`. Canonical helper `getISTDate()` | `attendanceCtrl.js:113-118` |
| SQL convention: `DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')` | `attendanceCtrl.js:228-244, 381-387, 609, 621` |
| `Asia/Kolkata` / `330` is **hardcoded**; there is no per-organization timezone column anywhere | exhaustive grep; `organizations` has only `id, name, created_at, leave_renewal_type` |
| `moment-timezone` and `date-fns-tz` are in `package.json` but never imported | grep |
| ⚠️ `raw_clock_in` in API responses is **not** a true UTC instant — it is IST wall-clock re-serialized with a `Z` suffix. Do not treat it as UTC | `attendanceCtrl.js:281-298` |
| ⚠️ SQL `CURRENT_DATE` is a **UTC** date and diverges from the IST date between 00:00–05:30 IST. Never use it for "today" | measured |

### 2.4 Expected Clock-In Time

| Fact | Evidence |
|---|---|
| Column `employees.expected_clock_in_time TIME NULL` | `information_schema.columns` |
| Read (merged onto `getEmployeeById`, `authenticate` only) | `controllers/employeeCtrl.js:266-277`; `routes/employeesRoute.js:42` |
| Write (admin-gated, inline) | `controllers/employeeCtrl.js:297, 317-322`; `routes/employeesRoute.js:44` |
| **Nothing computes lateness server-side today** | exhaustive grep — only 4 backend references exist |
| The only lateness logic is client-side | `attendix-admin-panel/src/components/EmployeeAttendanceTab.jsx:281-325` |
| Admin UI is a 12-hour Hour/Minute/AM-PM selector storing `HH:mm` | `src/pages/EditEmployee.jsx:24-53, 121-131, 155-167, 283-348` |
| ⚠️ Live coverage: **1 of 15** active employees has a value set — the punctuality rule is inert for the other 14 until an admin configures them | `SELECT COUNT(expected_clock_in_time) FROM employees WHERE status='active'` |

**Existing client-side lateness semantics that the server must reproduce exactly** (`EmployeeAttendanceTab.jsx:281-325`): compare **minutes-of-day**; `diff = actual − expected`; `diff <= 0` means on time; seconds are truncated; no grace period; only today's record; the value parsed is the already-formatted `"h:mm AM/PM"` display string.

### 2.5 Organization settings patterns

Five patterns coexist. The one to imitate is `auto_absent_settings`.

| Pattern | Shape | Verdict |
|---|---|---|
| Column on `organizations` (`leave_renewal_type`) via `GET/PUT /api/auth/organization-settings`, in-controller admin gate, `setImmediate` resync | `controllers/authCtrl.js:534-564, 570-632` | not suitable — `organizations` would need many columns |
| **`auto_absent_settings`** — one row/org, `UNIQUE(organization_id)`, `ON CONFLICT DO UPDATE`, defaults synthesized when absent | `services/autoAbsentService.js:38-82` | **imitate this** |
| `work_week_policies` — same, service-layered, tenant-checked `PUT /:id` | `services/compOffService.js:143-224` | imitate for slab `PUT /:id` |
| `leave_policies` — org + discriminator, multi-row | `services/leavePolicyService.js:129-165` | imitate for slabs table |
| `attendance_tracking_settings` — no unique constraint, manual SELECT-then-UPDATE, no validation, different response envelope | `controllers/trackingSettingsController.js` | **do not copy** |

### 2.6 Auth and roles

| Fact | Evidence |
|---|---|
| `authenticate` sets `req.user` = raw JWT payload | `middleware/authMiddleware.js` |
| Admin/employee JWT claims: `{ user_id, employee_id, organization_id, role }` | `controllers/authCtrl.js:52-61, 155-164, 324-334, 394-403` |
| ⚠️ Support JWT carries only `{ support_user_id, role: 'support' }` — **no `employee_id`, no `organization_id`** | `controllers/authCtrl.js:453-460` |
| `authorizeRoles(...)` is an exact match on `req.user.role`; admin tokens set `role: 'admin'` exactly, so `authorizeRoles('admin')` works | `middleware/authMiddleware.js` |
| Canonical admin-excluded population query | `controllers/reportCtrl.js:64` — `status = 'active' AND role != 'admin'` |
| ⚠️ Live `employees.role` values are free-text job titles: `admin, developer, manager, social media manager` | `SELECT DISTINCT LOWER(role) FROM employees` |
| ⚠️ Frontend `ProtectedRoute` checks **only the token — there is no role gating at the route level**. An employee can reach `/dashboard`. Backend enforcement is mandatory | `attendix-admin-panel/src/ProtectedRoute.jsx:5-15` |

### 2.7 Schema-change convention

- **No migrations framework. No `migrations/` directory. No `.sql` files anywhere in the repo.**
- All schema changes are hand-run Node scripts at the backend repo root: `create_auto_absent_exclusions_table.js`, `create_device_tokens_table.js`, `add_expected_clock_in_time_column.js`.
- **Zero views and zero triggers exist in the `public` schema** — all logic is application-side or in stored functions.
- ⚠️ `leave_requests` and `attendance` have **only primary-key indexes**. No index on `employee_id` or on any date column.

### 2.8 Greenfield confirmation

Repo-wide case-insensitive greps for `reward|points|score|rank|badge|leaderboard|ledger|gamif` return **zero** matches in backend and frontend `src`. The live DB has **no** table matching `%reward%|%point%|%rank%|%score%|%badge%|%ledger%`. Nothing to retrofit.

---

## 3. Business rules (FINAL)

### 3.1 System-level enable/disable

- Reward Points is an **organization-level** system with a single master switch, `reward_settings.is_enabled`.
- **When disabled:**
  - No new ledger rows are generated (both hooks return early).
  - `GET /api/rewards/ranking` and `GET /api/rewards/my-ranking` return a disabled marker with an empty payload. Frontend renders nothing.
  - Employees see no points/rank. Admins see no ranking.
  - **Existing ledger rows are never deleted.**
- **On re-enable:** all previously stored ledger rows become visible again, subject to the Start Date filter in §3.2 and the selected date range.
- **No reward value may be hardcoded anywhere.** Every threshold and point value comes from the database.

### 3.2 Reward System Start Date

- `reward_settings.start_date DATE` — set by the admin. Interpreted as an **IST calendar date**.
- Only reward activity occurring **on or after** this date is eligible.
  - Leave rule: eligibility is judged on the **approval date (IST)**.
  - Punctuality rule: eligibility is judged on the **work date (IST)**.
- **No automatic backfill in v1.** Activity before the start date never produces ledger rows.

**Start Date is enforced in two places, and this is deliberate:**

1. **At generation time** (both hooks) — refuse to insert a row whose `award_date < start_date`.
2. **At ranking time** — the effective range is `award_date BETWEEN GREATEST(from, start_date) AND to`.

Enforcing it at ranking time as well is what makes Start Date changes safe and non-destructive:

| Admin action | Effect on stored rows | Effect on ranking |
|---|---|---|
| Moves Start Date **later** | Rows before the new date are **kept**, never deleted | Those rows stop counting immediately |
| Moves Start Date **earlier** | Nothing changes | Previously hidden rows (if any) count again. Because v1 never backfills, rows earlier than the *original* start date will not exist unless the date had previously been moved later |
| Disables then re-enables the system | Rows kept throughout | Ranking resumes, filtered by the current Start Date |

`start_date` is **required** whenever `is_enabled = true`.

### 3.3 Leave early-application reward

Configuration: `leave_early_enabled`, `leave_early_days_before` (integer ≥ 0), `leave_early_points` (integer ≥ 0).

**Award timing — FINAL: only on approval.** Points are never awarded when the employee creates the request.

```
Employee applies  →  status = pending  →  Admin/manager approves
                                              ↓
                              was it applied ≥ N days early?
                                              ↓
                                      yes → award points
```

- Eligibility uses **greater-than-or-equal** semantics. With `leave_early_days_before = 3`: applied 3, 4, 5, 10 days before → eligible; 2 days before → not eligible.
- `days_before = leave_start_date − application_date_IST`, where `application_date_IST` is `leave_requests.created_at` shifted to IST and truncated to a date. Both operands are IST calendar dates, so the result is a whole number of days.
- **Reward date (`award_date`) = the leave approval date in IST**, derived from the `updated_at` value returned by `update_leave_request_status`, shifted +330 minutes and truncated to a date.
- **Rejected leave → no award.** Because v1 awards only on approval, no reversal is required in the normal flow. The ledger nevertheless carries a `status` column (`active` \| `reversed`) so a future reversal flow needs no schema change.
- **Idempotency:** exactly one ledger row per `(employee_id, rule_type='leave_early_application', leave_request_id)`, enforced by a partial unique index. This is essential, not defensive — `update_leave_request_status` has no re-entry guard, so repeated approvals *will* re-run the hook.
- Auto-absent rows (`services/autoAbsentService.js:210-221`) bypass the approval controller entirely and therefore never earn points. No extra filter is needed.

**Documented consequence:** because points accrue only on approval and the live system currently holds 290 pending vs 29 approved requests, leave points will materialize only as admins work through approvals. This is accepted business behaviour.

### 3.4 Punctuality reward

- Source of truth for the expected time is the **existing employee-level `employees.expected_clock_in_time`**. No organization-level default is introduced.
- If `expected_clock_in_time IS NULL` → **no reward**, no ledger row.
- Configuration: `punctuality_enabled` plus a configurable list of slabs in `reward_punctuality_slabs`.

**Slab semantics.**

- A slab is `(max_minutes_late, points)` and means: *"if the employee is late by no more than `max_minutes_late` minutes, award `points`."* The bound is **inclusive**.
- `minutes_late = actual_minutes_of_day − expected_minutes_of_day`, computed in IST, with **negative values clamped to 0**.
- The matching slab is the one with the **smallest `max_minutes_late` that is still ≥ `minutes_late`**:
  `WHERE max_minutes_late >= :minutes_late ORDER BY max_minutes_late ASC LIMIT 1`
- If no slab matches (the employee is later than every configured slab) → **no reward**.

Worked example with slabs `5 → 5 pts`, `10 → 3 pts`, `15 → 1 pt`, expected `10:00`:

| Actual clock-in | `minutes_late` | Matched slab | Points |
|---|---|---|---|
| 09:45 (early) | 0 (clamped) | 5 | 5 |
| 10:00 (exactly on time) | 0 | 5 | 5 |
| 10:04 | 4 | 5 | 5 |
| 10:05 | 5 | 5 | 5 |
| 10:06 | 6 | 10 | 3 |
| 10:15 | 15 | 15 | 1 |
| 10:16 | 16 | none | **0 — no row inserted** |

**Early and exactly-on-time both clamp to 0 and therefore receive the lowest-threshold (highest-value) slab.** This is intentional: earlier is never worse than later, and it matches the existing UI, which treats `diff <= 0` as on time. If the business later wants early arrival valued differently from a 5-minute delay, the admin simply adds a `max_minutes_late = 0` slab — no code change required.

**Other punctuality rules.**
- Award only on the **first `'in'` punch of the IST calendar day**. Multiple sessions on the same day produce exactly one reward.
- Missing clock-in → no reward.
- `award_date = work_date` = the IST calendar date of the punch.
- Lateness must be computed with the **same minutes-of-day semantics** as `EmployeeAttendanceTab.jsx:281-325`, so that the late banner and the points never disagree.
- **Idempotency:** exactly one row per `(employee_id, rule_type='punctuality', work_date)`, enforced by a partial unique index.

### 3.5 Admin exclusion

- **Admins never earn reward points.** Both hooks must skip an employee whose `employees.role` matches admin. This matters because `POST /api/leave` has no role guard, so an admin can legitimately create and have approved a leave request.
- **Admins never appear in any ranking.**
- Admins configure settings and view the organization ranking.
- Exclusion is enforced **server-side** in the hooks and in the ranking query. Frontend hiding alone is not acceptable (`ProtectedRoute` has no role gate).
- Match expression: `LOWER(COALESCE(e.role, '')) NOT LIKE '%admin%'`. This mirrors the frontend's `.includes("admin")` behaviour. See §14 for the known limitation.

### 3.6 Ranking rules

- Organization-scoped from the JWT's `organization_id`. **A caller must never be able to see another organization's employees or points** — the org id is never read from the request body or query string.
- Includes only employees where `COALESCE(status,'active') = 'active'`.
- Excludes admins (§3.5).
- **Includes employees with zero points** (via `LEFT JOIN`), so the whole team is visible.
- Ties share a rank via **`DENSE_RANK()`**, ordered by points descending. Secondary sort by `name ASC` for stable display.
- Date range: `from` / `to`, defaulting to first-day-of-current-month → today. Effective range is intersected with Start Date per §3.2.
- Only `status = 'active'` ledger rows are summed.

---

## 4. Database design

Three additive tables. **No existing table is modified.** Leave balance tables, `leave_requests`, `attendance`, and `employees` are untouched.

### 4.1 `reward_settings` — one row per organization

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `organization_id` | `INTEGER NOT NULL` | `REFERENCES organizations(id) ON DELETE CASCADE` |
| `is_enabled` | `BOOLEAN NOT NULL DEFAULT false` | master switch |
| `start_date` | `DATE NULL` | IST calendar date; required when `is_enabled = true` |
| `leave_early_enabled` | `BOOLEAN NOT NULL DEFAULT false` | |
| `leave_early_days_before` | `INTEGER NULL` | ≥ 0 |
| `leave_early_points` | `INTEGER NULL` | ≥ 0 |
| `punctuality_enabled` | `BOOLEAN NOT NULL DEFAULT false` | |
| `created_at` | `TIMESTAMP NOT NULL DEFAULT NOW()` | |
| `updated_at` | `TIMESTAMP NOT NULL DEFAULT NOW()` | maintained by the upsert, not a trigger (no triggers exist in this DB) |

Constraints: `UNIQUE (organization_id)`; `CHECK (leave_early_days_before IS NULL OR leave_early_days_before >= 0)`; `CHECK (leave_early_points IS NULL OR leave_early_points >= 0)`.

### 4.2 `reward_punctuality_slabs` — many rows per organization

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `organization_id` | `INTEGER NOT NULL` | `REFERENCES organizations(id) ON DELETE CASCADE` |
| `max_minutes_late` | `INTEGER NOT NULL` | inclusive upper bound; `0` = on time or early |
| `points` | `INTEGER NOT NULL` | |
| `created_at` / `updated_at` | `TIMESTAMP NOT NULL DEFAULT NOW()` | |

Constraints: `UNIQUE (organization_id, max_minutes_late)`; `CHECK (max_minutes_late >= 0)`; `CHECK (points >= 0)`.

A relational table is used rather than a JSON column so the award query can join it directly in SQL and the admin UI can CRUD rows using the existing holiday-management pattern.

### 4.3 `employee_reward_points` — the ledger (source of truth)

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `organization_id` | `INTEGER NOT NULL` | `REFERENCES organizations(id) ON DELETE CASCADE`; denormalized so ranking needs no extra join |
| `employee_id` | `INTEGER NOT NULL` | `REFERENCES employees(id) ON DELETE CASCADE` |
| `rule_type` | `VARCHAR(32) NOT NULL` | `CHECK (rule_type IN ('leave_early_application','punctuality'))` |
| `points` | `INTEGER NOT NULL` | `CHECK (points >= 0)` |
| `award_date` | `DATE NOT NULL` | IST calendar date the points count toward — the **only** column ranking filters on |
| `leave_request_id` | `INTEGER NULL` | `REFERENCES leave_requests(id) ON DELETE CASCADE`; set for the leave rule |
| `work_date` | `DATE NULL` | IST date; set for the punctuality rule |
| `status` | `VARCHAR(16) NOT NULL DEFAULT 'active'` | `CHECK (status IN ('active','reversed'))` |
| `meta` | `JSONB NULL` | how the reward was calculated — see below |
| `created_at` / `updated_at` | `TIMESTAMP NOT NULL DEFAULT NOW()` | |

`meta` contents (for audit and admin support queries):
- leave rule: `{"days_before": 5, "applied_on": "2026-09-05", "leave_start_date": "2026-09-10", "approved_on": "2026-09-06", "configured_days_before": 3}`
- punctuality: `{"minutes_late": 4, "expected_time": "10:00", "actual_time": "10:04", "slab_id": 12, "slab_max_minutes_late": 5}`

### 4.4 Uniqueness — duplicate-reward prevention

Two **partial** unique indexes, one per source kind. This generalizes the proven `compensation_earned` `UNIQUE (employee_id, work_date)` + `ON CONFLICT DO NOTHING` pattern (`services/compOffService.js:442-517`).

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_points_leave
  ON employee_reward_points (employee_id, rule_type, leave_request_id)
  WHERE leave_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_points_workdate
  ON employee_reward_points (employee_id, rule_type, work_date)
  WHERE work_date IS NOT NULL;
```

Keying punctuality on **`work_date`** rather than `attendance.id` is what makes "first punch of the day only" a database guarantee, which in turn neutralizes multiple same-day sessions and duplicate API calls.

### 4.5 Performance indexes

```sql
CREATE INDEX IF NOT EXISTS idx_reward_points_org_date ON employee_reward_points (organization_id, award_date);
CREATE INDEX IF NOT EXISTS idx_reward_points_emp_date ON employee_reward_points (employee_id, award_date);
CREATE INDEX IF NOT EXISTS idx_reward_slabs_org       ON reward_punctuality_slabs (organization_id);
```

**Out of scope but noted:** `leave_requests` and `attendance` currently have only primary-key indexes. The two hooks each add one small indexed-by-PK lookup and one date-filtered `attendance` count, so v1 does not require new indexes on existing tables. If a backfill tool is ever added, `idx_attendance_emp_ts (employee_id, timestamp)` will be needed first. **Do not add indexes to existing tables as part of v1.**

---

## 5. Migration / deployment

Local and production databases share the same structure. The schema change must therefore be a **single reusable, idempotent script committed to the backend repo**, run manually against each environment. There must be no separate, undocumented production-only SQL.

**File to create:** `C:\Attendixapp\Attendix_Backend\attendix\create_reward_tables.js`

It must follow the existing convention exactly — see `create_auto_absent_exclusions_table.js` as the template: `require("dotenv").config()`, `require("./configure/dbConfig")`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `console.log` on success, `console.error` + `process.exitCode = 1` on failure, `pool.end()` in `finally`.

Because Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, all uniqueness is expressed as `CREATE UNIQUE INDEX IF NOT EXISTS` (also required for the two partial indexes) or as inline `UNIQUE`/`CHECK` inside `CREATE TABLE IF NOT EXISTS`, keeping the whole script safely re-runnable.

### 5.1 Script content (implement verbatim)

```js
// One-off, idempotent setup script for the Reward Points & Employee Ranking module.
// Creates: reward_settings, reward_punctuality_slabs, employee_reward_points
// Run manually:  node create_reward_tables.js
// Must be run against BOTH the local and the production database (see REWARD_POINTS_MODULE.md §5.2).
require("dotenv").config();
const pool = require("./configure/dbConfig");

const main = async () => {
  try {
    // ── 1. Organization-level reward settings (one row per organization) ──────
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

    // ── 2. Punctuality reward slabs (many rows per organization) ─────────────
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

    // ── 3. Reward points ledger (append-only source of truth) ───────────────
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

    // ── 4. Duplicate-reward prevention (partial unique indexes) ─────────────
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_points_leave
        ON employee_reward_points (employee_id, rule_type, leave_request_id)
        WHERE leave_request_id IS NOT NULL;
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_points_workdate
        ON employee_reward_points (employee_id, rule_type, work_date)
        WHERE work_date IS NOT NULL;
    `);

    // ── 5. Ranking / lookup indexes ─────────────────────────────────────────
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
```

### 5.2 Run instructions

**LOCAL DB**
```
cd C:\Attendixapp\Attendix_Backend\attendix
node create_reward_tables.js
```

**DEPLOYMENT (PRODUCTION)**
1. Deploy the backend code to production.
2. On the production host, with the production `.env` in place, run **the same script**:
   ```
   node create_reward_tables.js
   ```
3. Verify the three tables and both partial unique indexes exist before enabling the feature for any organization.

The script is idempotent and safe to re-run. **Do not** hand-write separate production SQL. **Do not** run the script as part of this documentation task.

---

## 6. Backend architecture

Follows the existing service → controller → route layering.

### 6.1 Files to create

| File | Responsibility |
|---|---|
| `create_reward_tables.js` | idempotent schema setup (§5) |
| `services/rewardSettingsService.js` | all settings + slab SQL; `validateRewardSettings()`, `validateSlab()` throwing message-carrying `Error`s |
| `services/rewardPointsService.js` | `awardLeaveEarlyApplication()`, `awardPunctuality()`, `reverseAwardsForLeaveRequest()` (present but unused in v1) |
| `services/rewardRankingService.js` | `getOrganizationRanking()`, `getEmployeeRanking()` |
| `controllers/rewardController.js` | `ensureOrganization`, `ensureAdminAccess`, `/invalid\|required\|must/i → 400 else 500` mapping |
| `routes/rewardRoute.js` | route definitions + middleware |

### 6.2 Files to modify (minimal, additive only)

| File | Change |
|---|---|
| `index.js` | add `require("./routes/rewardRoute")` to the require block (`:65-86`) and `app.use("/api/rewards", rewardRoute);` to the mount block (`:88-108`) |
| `controllers/leaveCtrl.js` | one new error-swallowing `try/catch` block inside the live `updateLeaveRequestStatus`, after the push-notification block (~`:1034`), before the response |
| `controllers/attendanceCtrl.js` | one new error-swallowing `try/catch` block inside `clockIn`, after the `clock_in()` call (~`:33`), before the response |

Nothing else in these files may change. Response shapes, status codes, balance logic and existing side effects stay exactly as they are.

### 6.3 API endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/rewards/settings` | `authenticate` + `authorizeRoles('admin')` + in-controller `ensureAdminAccess` | returns settings **and** slabs; synthesizes a default disabled object when no row exists (per `autoAbsentService.js:48-57`) — never 404 |
| PUT | `/api/rewards/settings` | admin | upsert `ON CONFLICT (organization_id)`; returns the saved row |
| POST | `/api/rewards/slabs` | admin | create one slab |
| PUT | `/api/rewards/slabs/:id` | admin | update; must verify `id AND organization_id` match before writing (tenant safety, per `compOffService.js:189-224`) |
| DELETE | `/api/rewards/slabs/:id` | admin | delete; same tenant check |
| GET | `/api/rewards/ranking?from&to` | `authenticate` + `authorizeRoles('admin')` | organization leaderboard |
| GET | `/api/rewards/my-ranking?from&to` | `authenticate` | caller's own points, rank and period |

**No recalculation/backfill endpoint in v1.** There is no v1 requirement for it, historical backfill is explicitly excluded, and omitting it removes the risk of an admin accidentally rewriting the ledger. It can be added later without schema change.

**Authorization requirements.**
- Defense in depth: route-level `authorizeRoles('admin')` *and* an in-controller admin check, matching the `leavePolicyController.js:7-17` + `routes/leavePolicyRoutes.js:9-11` precedent.
- `organization_id` always comes from `req.user.organization_id`. It must **never** be read from the query string or body.
- Every handler must guard for missing claims — a support token carries no `employee_id`/`organization_id`. Return `400 "Organization ID missing in token"` (the `leaveCtrl.js:548-553` idiom).
- `/my-ranking` additionally requires `req.user.employee_id`; return 400 if absent.

**Response envelope:** `{ statusCode, message, data }` — the dominant convention. 200 for reads and updates, 201 for slab creation.

**Disabled-system response** for both ranking endpoints (HTTP 200):
```json
{ "statusCode": 200, "message": "Reward system is disabled", "rewardSystemEnabled": false, "data": [] }
```
`/my-ranking` returns `"data": null`. When enabled, `rewardSystemEnabled: true` and the payload is populated. The frontend renders its widget only when `rewardSystemEnabled === true`.

### 6.4 Validation rules

**Settings (`PUT /api/rewards/settings`)**
| Field | Rule |
|---|---|
| `is_enabled` | boolean; coerce with `typeof x === "boolean" ? x : false` (per `leavePolicyService.js:52-60`) |
| `start_date` | **required when `is_enabled = true`**; must parse as `YYYY-MM-DD`. Reject otherwise: `"start_date is required when the reward system is enabled"` |
| `leave_early_enabled` | boolean |
| `leave_early_days_before` | required when `leave_early_enabled = true`; integer ≥ 0 |
| `leave_early_points` | required when `leave_early_enabled = true`; integer ≥ 0 |
| `punctuality_enabled` | boolean |

- A future `start_date` is **allowed** (schedule the programme ahead of time); it simply means nothing is eligible yet.
- When `leave_early_enabled = false`, `leave_early_days_before` / `leave_early_points` may be `null`.
- Enabling `punctuality_enabled` with **zero slabs configured is allowed** but produces no awards. The UI must warn; the API must not reject.

**Slabs (`POST`/`PUT /api/rewards/slabs`)**
| Field | Rule |
|---|---|
| `max_minutes_late` | required; integer ≥ 0; unique per organization — a duplicate must return **400** `"A slab for this max_minutes_late already exists"`, not a 500 from the constraint |
| `points` | required; integer ≥ 0 |

**Ranking query params**
- `from` / `to`: optional `YYYY-MM-DD`. Defaults: `from` = first day of the current IST month, `to` = today (IST).
- Reject `from > to` with 400.
- Compute defaults from the **IST** date, never from SQL `CURRENT_DATE` (which is UTC).

### 6.5 Reward calculation flow

#### Leave approval hook

Location: `controllers/leaveCtrl.js`, inside the live `updateLeaveRequestStatus`, immediately after the push-notification block (~`:1034`) and before the 200 response.

```
if (status !== 'approved') → return            // rejection awards nothing in v1
load reward_settings for the employee's organization
if (!settings || !settings.is_enabled) → return
if (!settings.leave_early_enabled) → return
if (!settings.start_date) → return
approval_date_IST = IST_date(updated_at returned by update_leave_request_status)
if (approval_date_IST < settings.start_date) → return
load the leave row + employee (single query, below)
if (employee.role matches admin) → return
if (employee.status is not active) → return
application_date_IST = IST_date(leave_requests.created_at)
days_before = leave.start_date − application_date_IST      // whole days
if (days_before < settings.leave_early_days_before) → return
INSERT ledger row (award_date = approval_date_IST, leave_request_id = leave.id)
   ON CONFLICT DO NOTHING
```

The context query — `update_leave_request_status` returns `start_date` and `employee_id` but **not** `created_at`, so one lookup is required. It also supplies the employee's own `organization_id`, which is safer than trusting the approver's token:

```sql
SELECT lr.created_at,
       lr.start_date,
       lr.employee_id,
       e.organization_id,
       e.role,
       COALESCE(e.status, 'active') AS status
FROM leave_requests lr
JOIN employees e ON e.id = lr.employee_id
WHERE lr.id = $1
LIMIT 1
```

#### Punctuality hook

Location: `controllers/attendanceCtrl.js`, inside `clockIn`, after the `clock_in()` call (~`:33`) and before the 201 response.

```
punch = result.rows[0]                          // has id + timestamp
work_date = IST_date(punch.timestamp)
load reward_settings for req.user.organization_id
if (!settings || !settings.is_enabled) → return
if (!settings.punctuality_enabled) → return
if (!settings.start_date || work_date < settings.start_date) → return
load employee: expected_clock_in_time, role, status
if (expected_clock_in_time IS NULL) → return
if (role matches admin || status not active) → return
verify this is the FIRST 'in' punch of work_date  (query below)
minutes_late = max(0, actual_minutes_of_day − expected_minutes_of_day)
slab = smallest slab with max_minutes_late >= minutes_late
if (!slab) → return
INSERT ledger row (award_date = work_date, work_date = work_date)
   ON CONFLICT DO NOTHING
```

First-punch check (the unique index is the real guarantee; this avoids pointless work and keeps `meta` accurate):

```sql
SELECT COUNT(*)::int AS in_count
FROM attendance
WHERE employee_id = $1
  AND type = 'in'
  AND DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $2::date
```
The row just inserted is included, so **first punch ⇔ `in_count = 1`**.

Slab lookup:
```sql
SELECT id, max_minutes_late, points
FROM reward_punctuality_slabs
WHERE organization_id = $1
  AND max_minutes_late >= $2
ORDER BY max_minutes_late ASC
LIMIT 1
```

`actual_minutes_of_day`: take the `timestamp` returned by `clock_in()`, add 330 minutes, then read hours×60 + minutes from the **UTC** components of the shifted value — the same trick the backend already uses at `attendanceCtrl.js:261-262`. This is timezone-independent of the Node host and reproduces the frontend's minutes-of-day comparison exactly.

`expected_minutes_of_day`: `expected_clock_in_time` arrives from `pg` as a `"HH:MM:SS"` string; split on `:` and take hours×60 + minutes, ignoring seconds (matching `EditEmployee.jsx:90-92`, which stores only `HH:mm`).

#### Insert contract

Both awards use the same idempotent insert and the three-state return shape proven by `earnCompOff` (`services/compOffService.js:442-517`):

```sql
INSERT INTO employee_reward_points
  (organization_id, employee_id, rule_type, points, award_date,
   leave_request_id, work_date, status, meta, created_at, updated_at)
VALUES ($1,$2,$3,$4,$5::date,$6,$7::date,'active',$8::jsonb,NOW(),NOW())
ON CONFLICT DO NOTHING
RETURNING *
```
Return `{ created: true|false, duplicate: true|false, data }`. A duplicate is a normal, non-error outcome and must never throw.

#### Error handling — chosen approach

**Non-transactional, fire-and-forget, error-swallowing** — the same contract as every existing side effect in both controllers.

Justification: the surrounding architecture is already non-transactional. On leave approval, the status update, the two balance syncs, the email and the push are five independent operations, each in its own `try/catch` that logs and continues (`leaveCtrl.js:977-1034`). Clock-out behaves identically (`attendanceCtrl.js:75-94`). Introducing a transaction around the reward insert would mean either wrapping the pre-existing calls (a rewrite of the leave/attendance flow, explicitly forbidden by §12 of the requirements) or holding a transaction across unrelated side effects. A reward-points failure must never turn a successful approval or a successful clock-in into an error.

Therefore: `try { await award...(); } catch (rewardError) { console.error("Reward points award failed:", rewardError.message); }`. Correctness under failure is preserved by the unique indexes — a retry or a later duplicate call converges to exactly one row.

### 6.6 Ranking query

```sql
SELECT e.id                                  AS employee_id,
       e.name                                AS employee_name,
       e.email,
       COALESCE(SUM(r.points), 0)::int       AS reward_points,
       DENSE_RANK() OVER (ORDER BY COALESCE(SUM(r.points), 0) DESC)::int AS rank
FROM employees e
LEFT JOIN employee_reward_points r
       ON r.employee_id = e.id
      AND r.status      = 'active'
      AND r.award_date BETWEEN $2::date AND $3::date
WHERE e.organization_id = $1
  AND COALESCE(e.status, 'active') = 'active'
  AND LOWER(COALESCE(e.role, '')) NOT LIKE '%admin%'
GROUP BY e.id, e.name, e.email
ORDER BY reward_points DESC, e.name ASC
```

- `$2` is the **effective from-date** = `GREATEST(requested_from, settings.start_date)`, computed in the service.
- `$3` is the requested to-date.
- The date filter sits in the `LEFT JOIN` (not `WHERE`), which is what keeps zero-point employees in the result.
- `DENSE_RANK` gives tied employees the same rank with no gaps in the sequence — the requested behaviour, and the right choice here because the board is small (15 active employees) and consecutive ranks read more naturally than the gaps `RANK()` would leave.

`getEmployeeRanking()` runs the same query and then picks the caller's row, returning `{ employee_id, reward_points, rank, total_ranked, from, to }`. Deriving the employee's rank from the identical query guarantees the employee's own view and the admin board can never disagree.

### 6.7 Timezone handling

- All reward dates are **IST calendar dates** stored in plain `DATE` columns. Ranking therefore filters with a plain `BETWEEN` and needs no conversion at query time — this is what makes the range semantics stable.
- Derive IST dates with the existing convention (`+330` minutes, then take the date), reusing `getISTDate()` (`attendanceCtrl.js:113-118`) where a date-from-now is needed.
- **Never** use SQL `CURRENT_DATE` for "today" — the DB server runs in UTC and its date differs from the IST date between 00:00 and 05:30 IST.
- Frontend default dates must use the existing local-parts helpers (`EmployeeAttendanceTab.jsx:10-20`), not `toISOString()`.
- Single hardcoded `Asia/Kolkata`, consistent with the rest of the system. No per-organization timezone is introduced.

---

## 7. Frontend design

### 7.1 Admin Reward Settings screen

- **New file:** `src/pages/RewardSettings.jsx`
- **Route:** `/reward-settings`, registered in `src/App.jsx` inside `<ProtectedRoute>`
- **Sidebar:** add `{ name: "Reward Settings", href: "/reward-settings", icon: Trophy }` to the `isAdminRole` array in `src/components/Layout.jsx:181-202`, importing the icon from `lucide-react` (`:3-21`)
- **Template:** `src/pages/TrackingSettings.jsx` — the only pure singleton-org-config screen in the app: one flat state object, `GET` on mount, validate, single `PUT` of the whole object, then refetch. Use `Card`/`CardHeader`/`CardContent`, `Switch`, `Input type="number"`, `Label` from `src/components/ui/`.
- **Slab rows:** local array state with add/edit/delete rows, each persisted through its own `POST`/`PUT`/`DELETE` and followed by a list refetch — the holiday-management pattern (`WorkWeekPolicyPage.jsx:219-279` for CRUD, `:523-595` for the `Card` + `Table` render).

Required fields:

| Control | Field | Behaviour |
|---|---|---|
| Switch | Reward Points System | master toggle; when off, grey out everything below with `opacity-40 pointer-events-none` (the `TrackingSettings.jsx:128-134` idiom) |
| Date input | Reward System Start Date | required when the master switch is on |
| Switch | Leave Early Reward | |
| Number | Days Before Leave | integer ≥ 0; shown only when Leave Early Reward is on |
| Number | Reward Points | integer ≥ 0; shown only when Leave Early Reward is on |
| Switch | Punctuality Reward | |
| Table + row editor | Punctuality Slabs — `Max Minutes Late` \| `Reward Points` \| actions | add / edit / delete; sorted ascending by `max_minutes_late` |

The example values (5→5, 10→3, 15→1) are illustrative only and must **not** be seeded, defaulted, or hardcoded. A new organization starts with the system disabled and zero slabs.

Client-side validation must mirror §6.4 and show `toast.error` before submitting. Additionally warn (do not block) when Punctuality Reward is enabled with zero slabs: *"No slabs configured — no punctuality points will be awarded."*

### 7.2 Admin ranking

- **File:** `src/pages/Dashboard.jsx` — add a new full-width section as a sibling `<div>` inside the existing `space-y-6` wrapper, after the three-panel grid (after `:410`).
- Card + Table render per `WorkWeekPolicyPage.jsx:523-595`; zebra striping and uppercase header cells per `LeaveReport.jsx:648-679`.
- Columns: **Rank**, **Employee**, **Reward Points**.
- From/To date inputs above the table, using the §7.4 pattern.
- Render the section only when the API returns `rewardSystemEnabled === true`; render nothing at all when disabled.
- Do not disturb the existing four dashboard fetches or their state.

### 7.3 Employee own ranking

- **File:** `src/components/EmployeeAttendanceTab.jsx` — add a self-contained block immediately after the header card (after `:546`), before the manager tabs.
- Shows: **Total Reward Points**, **Current Rank** (e.g. `3 of 12`), and the **ranking period** (`1 Sep 2026 – 10 Sep 2026`).
- Use the hand-rolled stat-card idiom (`Dashboard.jsx:233-244`).
- Hidden entirely when `rewardSystemEnabled !== true`.
- Employees must not see the full leaderboard or any settings control on this screen.
- ⚠️ This file was recently modified (late-clock-in banner, list/card view work). Keep the addition to one isolated block and do not touch the existing attendance logic, the late banner, or the date filters.

### 7.4 Date range selector

Reuse the existing timezone-safe helpers verbatim (`EmployeeAttendanceTab.jsx:10-20`) — they avoid `toISOString()` precisely to prevent a UTC day shift:

```js
const getFirstDayOfMonth = () => { const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`; };
const getToday = () => { const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
```

State shape `{ from, to }`, passed as an axios `params` object, refetched by a `useCallback` + `useEffect` on change. Defaults: **From = first day of current month, To = today.**

---

## 8. Edge cases

### 8.1 System state

| Case | Behaviour |
|---|---|
| Reward system disabled | Both hooks return before inserting. Ranking endpoints return `rewardSystemEnabled: false` with an empty payload. No UI renders. Existing rows untouched |
| Reward system enabled | Normal operation from the Start Date onward |
| No `reward_settings` row for the org | Treated as disabled. `GET /settings` synthesizes a default disabled object rather than 404 |
| Existing points while disabled | Preserved. Never deleted, never modified |
| Re-enabling the system | Historical rows count again immediately, filtered by the current Start Date and the selected range |
| Start Date changed later | Rows before the new date are kept but stop counting in ranking (§3.2) |
| Start Date changed earlier | Rows in the newly included window count again. No backfill is performed, so no new rows appear |
| Start Date in the future | Valid. Nothing is eligible until that date |
| Start Date null while enabled | Rejected by validation. Hooks also defensively return early |

### 8.2 Leave rule

| Case | Behaviour |
|---|---|
| Approved exactly N days before | **Eligible** — `>=` semantics |
| Approved with more than N days' notice | Eligible; same fixed point value |
| Applied too late (< N days) | No row inserted |
| Leave rejected | No award. v1 never awards on rejection, so nothing to reverse |
| Multiple approval calls | Second and later calls hit `uq_reward_points_leave` → `ON CONFLICT DO NOTHING` → exactly one row. Essential, since `update_leave_request_status` has no re-entry guard |
| Approval on/after Start Date, application before it | **Eligible** — eligibility is judged on the approval date only |
| Approval before Start Date | Not eligible |
| Leave dates changed after award | Not possible through the API (no edit endpoint). Direct SQL edits would desync silently; accepted v1 limitation |
| Auto-absent leave rows | Never awarded — they bypass the approval controller entirely |
| Admin's own leave approved | No award (hook checks `employees.role`) |
| Approver is a reporting manager | Award goes to the **leave's employee**, never the approver. The manager remains rankable in their own right |
| Employee inactive at approval time | No award |

### 8.3 Punctuality rule

| Case | Behaviour |
|---|---|
| `expected_clock_in_time` IS NULL | No row. Currently applies to 14 of 15 active employees |
| Clocks in early | `minutes_late` clamped to 0 → lowest-threshold slab |
| Clocks in exactly on time | Identical to early — clamped to 0. Matches the UI's `diff <= 0` rule |
| Clocks in within a slab | That slab's points |
| Clocks in later than every slab | No row |
| No slabs configured | No row |
| Missing clock-in | No row (hook never runs) |
| Multiple clock-ins same day | Only the first `'in'` of the IST day; guaranteed by `uq_reward_points_workdate` |
| Duplicate/retried clock-in API calls | `ON CONFLICT DO NOTHING` → at most one row per employee per IST day |
| Admin clock-in | No award |
| Work date before Start Date | Not eligible |
| Clock-in between 00:00–05:30 IST | `work_date` is derived from the IST date, so the punch is attributed to the correct IST day even though the UTC date differs |
| Admin edits attendance | `adminUpdateClockOut` writes only `'out'` punches (`attendanceCtrl.js:636-637`), so clock-in awards are unaffected. If clock-**in** editing is ever added, the award will not self-correct in v1 |

### 8.4 Ranking

| Case | Behaviour |
|---|---|
| Employee with zero points | Included, `reward_points = 0`, ranked last (shared rank with other zeros) |
| Ties | Shared rank via `DENSE_RANK()`, no gaps; display order broken by `name ASC` |
| Empty period (nobody scored) | Every active non-admin employee returned with 0 points and rank 1 |
| Employee inactive | Excluded from ranking; their ledger rows are retained for audit |
| Admin employee | Excluded server-side from both `/ranking` and `/my-ranking` totals |
| Organization isolation | `organization_id` taken only from the JWT; the ledger also carries `organization_id`, so cross-org leakage requires two independent mistakes |
| `from > to` | 400 |
| `from` earlier than Start Date | Silently clamped to the Start Date via `GREATEST(...)` |
| Support-role token | 400 — no `organization_id`/`employee_id` in the token |
| Employee calls `/ranking` | 403 (admin-only) |

---

## 9. Existing functionality that must not change

Strictly off-limits. Reward Points is purely additive.

- Leave balance calculation, entitlement, carry-forward, renewal logic, `total_entitled` — `services/leaveBalanceService.js` must not be touched
- Leave creation and approval behaviour, response shapes, and the existing five approval side effects
- Attendance/clock-in/clock-out behaviour and response shapes
- Existing Expected Clock-In Time read/write behaviour
- The existing late-clock-in banner in `EmployeeAttendanceTab.jsx`
- Existing dashboard widgets and their fetches
- Any API unrelated to rewards
- `package.json` — this module needs **no new dependencies**
- The legacy FlutterFlow project

Permitted modifications are exactly the three listed in §6.2, each additive.

---

## 10. Module implementation order

### M1 — DB Foundation
- **Goal:** create the three tables with constraints and indexes.
- **Create:** `create_reward_tables.js` (content in §5.1).
- **DB:** `reward_settings`, `reward_punctuality_slabs`, `employee_reward_points`, 2 partial unique indexes, 3 lookup indexes.
- **API / UI:** none.
- **Dependencies:** none.
- **Safety:** additive only; no existing table altered. Script must be idempotent.
- **Acceptance:** running the script twice succeeds with no error; all three tables and both partial unique indexes are present; inserting two rows with the same `(employee_id, rule_type, work_date)` fails on the second.

### M2 — Reward Settings Backend
- **Goal:** admin can read and write settings and slabs.
- **Create:** `services/rewardSettingsService.js`, `controllers/rewardController.js`, `routes/rewardRoute.js`.
- **Change:** `index.js` (require + mount).
- **API:** `GET/PUT /api/rewards/settings`; `POST /api/rewards/slabs`; `PUT/DELETE /api/rewards/slabs/:id`.
- **Dependencies:** M1.
- **Safety:** `organization_id` from JWT only; admin-gated at route and controller; tenant check on `:id` routes; duplicate slab returns 400 not 500.
- **Acceptance:** GET on a fresh org returns a disabled default without 404; enabling without `start_date` returns 400; a non-admin token gets 403; an admin from org A cannot modify a slab belonging to org B.

### M3 — Admin Reward Settings UI
- **Goal:** admin configures everything from the panel.
- **Create:** `src/pages/RewardSettings.jsx`.
- **Change:** `src/App.jsx` (route), `src/components/Layout.jsx` (sidebar entry).
- **API / DB:** none new.
- **Dependencies:** M2.
- **Safety:** no example values seeded or hardcoded; dependent fields disabled when their parent toggle is off.
- **Acceptance:** all §6.4 validations surface as toasts before any request; slabs can be added, edited and deleted and survive a reload; disabling the master switch greys out the rest of the form.

### M4 — Reward Ledger / Points Service
- **Goal:** idempotent award primitives, independently testable before any hook exists.
- **Create:** `services/rewardPointsService.js`.
- **API / UI:** none.
- **Dependencies:** M1, M2.
- **Safety:** all inserts `ON CONFLICT DO NOTHING`; duplicates return `{created:false, duplicate:true}` and never throw; enforces system-enabled, Start Date, admin-exclusion and active-status checks internally so no caller can bypass them.
- **Acceptance:** calling an award function twice with identical input produces exactly one row; awards are refused when the system is disabled, when `award_date < start_date`, for an admin employee, and for an inactive employee.

### M5 — Leave Approval Reward Hook
- **Goal:** award points on approval of an early-applied leave.
- **Change:** `controllers/leaveCtrl.js` — one new `try/catch` after ~`:1034`.
- **Dependencies:** M4.
- **Safety:** never awards on creation or rejection; never `await`s outside its own `try/catch`; does not alter the response, the balance syncs, the email or the push; derives `organization_id` from the employee row, not the approver's token.
- **Acceptance:** approving a leave applied exactly N days early creates one row with `award_date` = approval date IST; approving the same leave three times still yields one row; rejection creates none; applying N−1 days early creates none; existing leave-balance behaviour is byte-identical before and after.

### M6 — Expected Clock-In Punctuality Reward Hook
- **Goal:** award points on the first clock-in of an IST day.
- **Change:** `controllers/attendanceCtrl.js` — one new `try/catch` after ~`:33`.
- **Dependencies:** M4.
- **Safety:** `clockIn` currently has zero side effects, so keep the added work to two small queries plus one insert; must not change the clock-in response or introduce a failure path; must reproduce the UI's minutes-of-day semantics exactly.
- **Acceptance:** a punch 4 minutes late with slabs 5/10/15 awards the 5-slab points; a second punch the same day awards nothing; NULL expected time awards nothing; a punch later than every slab awards nothing; the existing late banner and the awarded slab always agree; clock-in still succeeds if the reward insert fails.

### M7 — Ranking API
- **Goal:** organization and personal ranking over a date range.
- **Create:** `services/rewardRankingService.js`; extend `controllers/rewardController.js` and `routes/rewardRoute.js`.
- **API:** `GET /api/rewards/ranking?from&to`; `GET /api/rewards/my-ranking?from&to`.
- **Dependencies:** M4.
- **Safety:** org scoping and admin exclusion enforced in SQL; Start Date clamped via `GREATEST`; disabled system returns the disabled marker.
- **Acceptance:** zero-point active employees appear; ties share a `DENSE_RANK`; admins never appear; an org-A token never sees org-B employees; `/my-ranking` rank matches the employee's row in `/ranking` for the same period; defaults are first-of-month → today in IST.

### M8 — Admin Ranking UI
- **Goal:** ranking table on the admin dashboard.
- **Change:** `src/pages/Dashboard.jsx`.
- **Dependencies:** M7.
- **Safety:** additive section only; existing four fetches and their state untouched; hidden entirely when the system is disabled.
- **Acceptance:** Rank / Employee / Reward Points render; changing From/To refetches and re-ranks; defaults are first-of-month → today; nothing renders when disabled.

### M9 — Employee Ranking UI
- **Goal:** employee sees their own points, rank and period.
- **Change:** `src/components/EmployeeAttendanceTab.jsx`.
- **Dependencies:** M7.
- **Safety:** one isolated block after the header card; must not touch the late banner, the attendance fetches, or the existing date filters in that file.
- **Acceptance:** own points, rank and period display; no leaderboard or settings control is visible to the employee; hidden when the system is disabled; existing attendance behaviour unchanged.

**Not in v1:** historical backfill, a recalculate endpoint, point expiry, redemption, manual adjustment, notifications. None is required by the business rules above, and omitting the recalculate endpoint removes the risk of an accidental ledger rewrite.

---

## 11. Verification checklist before sign-off

- [ ] `node create_reward_tables.js` run against **local**; three tables + two partial unique indexes verified
- [ ] Same script run against **production** after code deploy; same verification
- [ ] No existing table, stored function, view or trigger altered
- [ ] `services/leaveBalanceService.js` untouched
- [ ] Leave approval response, balance deduction, email and push behaviour unchanged
- [ ] Clock-in response unchanged; clock-in still succeeds when the reward insert fails
- [ ] Late-clock-in banner unchanged and consistent with awarded slabs
- [ ] No new npm dependency; `package.json` unchanged
- [ ] No hardcoded point values, day counts or slab thresholds anywhere in the code
- [ ] Admin appears in no ranking; earns no points
- [ ] Cross-organization access attempts return no foreign data
- [ ] Disabling the system hides all reward UI and preserves all ledger rows

---

## 12. Open items requiring a business decision

These do not block M1–M4 but must be settled before the module that depends on them.

1. **Should employees see the full leaderboard, or only their own rank?** This spec implements *own rank only* (`/my-ranking`), with `/ranking` restricted to admins, per requirement §5 ("Employee should not see admin ranking functionality"). If employees should also see the team leaderboard, `/ranking` must be relaxed to any authenticated org member and M9 expanded. **Needed before M7.**

2. **Admin detection relies on pattern-matching a free-text field.** `employees.role` holds job titles (live values: `admin`, `developer`, `manager`, `social media manager`), and exclusion uses `LOWER(role) NOT LIKE '%admin%'`. A future title such as *"admin assistant"* would be silently excluded from ranking. A dedicated `employees.exclude_from_ranking` boolean would be robust — but that modifies an existing table, which §12 of the requirements discourages. This spec keeps pattern-matching. **Confirm acceptable, or approve the extra column, before M7.**

3. **Gaming exposure on the leave rule is low but non-zero.** Awarding on approval (rather than creation) already removes the spam-application vector. What remains is unbounded points from many separate approved early requests, since there is no per-period cap. If a cap is wanted, add `leave_early_max_awards_per_month` to `reward_settings`. **Confirm before M5.**

4. **No `cancelled` leave status exists**, and there is no cancel endpoint. If leave cancellation is ever introduced, the reversal path (`reverseAwardsForLeaveRequest`, already present in M4 and supported by the `status` column) must be wired to it. No action needed for v1.

5. **Punctuality is effectively dormant until Expected Clock-In Times are populated** — 1 of 15 active employees currently has a value. This is an operational task for the admin, not a code change, but it should be scheduled alongside M6 or the feature will appear broken.
